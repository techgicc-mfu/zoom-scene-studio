"""Reference state machine & VP-1 curve math for the MIDISTOMP V2.0 scene-engine RTOS hook."""

from __future__ import annotations

from firmware.scene_zdl.build_zdl import SCENE_FXID

RIG_COUNT = 12
SHADOW_BASE_RECORD = 12  # Records 12..47 (3 shadow records per rig 0..11)


def wrap_rig_step(cur_patch: int, delta: int) -> int:
    """Clamps CC 80 / CC 81 stepping strictly to Gig Rigs 0..11 (Patches 01..12)."""
    if cur_patch < 0 or cur_patch >= RIG_COUNT:
        return 0
    return (cur_patch + delta) % RIG_COUNT


def vp1_curve_map(
    cc_val: int,
    curve_mode: int,
    exp_min: int,
    exp_max: int,
    param_max: int,
) -> int:
    """Maps incoming CC 16 (0..127) from Salfini VP-1 into target parameter units (0..param_max).

    curve_mode:
      0 = Linear (0..127 -> 0.0..1.0)
      1 = Salfini VP-1 Compensated (heel deadzone 0..3 -> 0.0; saturates smoothly at 100/127 ~78% travel)
      2 = Sunday Worship Swell (heel deadzone + quadratic x^2 audio taper)
    """
    raw = max(0, min(127, int(cc_val)))
    lo_pct = max(0, min(100, int(exp_min)))
    hi_pct = max(0, min(100, int(exp_max)))
    pmax = max(1, int(param_max))

    if curve_mode == 1:
        if raw <= 3:
            norm = 0.0
        elif raw >= 100:
            norm = 1.0
        else:
            norm = (raw - 3) / 97.0
    elif curve_mode == 2:
        if raw <= 3:
            norm = 0.0
        else:
            lin = min(1.0, (raw - 3) / 97.0)
            norm = lin * lin
    else:
        norm = raw / 127.0

    pct = lo_pct + norm * (hi_pct - lo_pct)
    scaled = int(round((pct / 100.0) * pmax))
    return max(0, min(pmax, scaled))


class SceneEngineSimulator:
    """Deterministic model of DDR shadow-caching, diffed FX_SET_PARAM calls, and IS_DIRTY guard."""

    def __init__(self) -> None:
        self.cur_rig: int = 0
        self.active_scene: int = 0  # 0=A, 1=B, 2=C, 3=D
        self.slot0_fxid: int = SCENE_FXID
        self.flash_reads: int = 0
        self.live_params: dict[tuple[int, int], int] = {}
        self.ddr_scene_cache: dict[int, dict[tuple[int, int], int]] = {}

    def load_rig(
        self,
        rig: int,
        scene_a: dict[tuple[int, int], int],
        shadows: dict[int, dict[tuple[int, int], int]],
    ) -> None:
        """Simulates loading Record `rig` and pre-caching its 3 Shadow Records into DDR once."""
        if not (0 <= rig < RIG_COUNT):
            raise ValueError(f"Playable Gig Rig must be 0..11, got {rig}")
        self.cur_rig = rig
        self.active_scene = 0
        self.live_params = dict(scene_a)
        # Pre-read 3 shadow flash records (B, C, D) into DDR at rig load time
        self.flash_reads += 3
        self.ddr_scene_cache = {
            0: dict(scene_a),
            1: dict(shadows.get(1, {})),
            2: dict(shadows.get(2, {})),
            3: dict(shadows.get(3, {})),
        }

    def select_scene(self, scene_idx: int) -> list[tuple[int, int, int]]:
        """Applies target scene from DDR cache without touching SPI flash; emits only changed (slot, param, val)."""
        target_scene = max(0, min(3, int(scene_idx)))
        self.active_scene = target_scene
        target_map = self.ddr_scene_cache.get(target_scene, {})

        dispatched: list[tuple[int, int, int]] = []
        for (slot, param), target_val in sorted(target_map.items()):
            if not (1 <= slot <= 5):
                continue
            if self.live_params.get((slot, param)) != target_val:
                self.live_params[(slot, param)] = target_val
                dispatched.append((slot, param, target_val))
        return dispatched

    def is_dirty_allowed(self, stock_dirty: int) -> int:
        """Prevents Zoom's 5s AUTO SAVE from overwriting Scene A in flash while Scenes B/C/D are active."""
        if self.slot0_fxid == SCENE_FXID and self.active_scene != 0:
            return 0
        return int(bool(stock_dirty))
