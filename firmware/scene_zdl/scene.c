/*
 * scene.c — Custom TI TMS320C674x DSP Audio Plugin ("SCENE.ZDL", fxid 0x0195)
 * Target: Original Zoom MS-50G running MIDISTOMP V2.0 (ms70cdr-2.10 unified OS)
 *
 * Strictly adheres to ZoomMultistompZDL SAFE-DSP-RULES:
 *   - No floating-point division
 *   - No .fardata / global mutable static arrays (uses host scratch arena at ctx[3])
 *   - Preserves ctx[11]/ctx[12] magic pointer shuttle for downstream chain continuity
 *   - Passes stereo audio cleanly regardless of Slot 0 bypass toggle, applying
 *     per-sample 1-pole smoothed Trim gain (-6.0 dB .. +6.0 dB in 0.5 dB steps).
 */

#include <stdint.h>

#pragma CODE_SECTION(Fx_FLT_SCENE, ".audio")

#define ZDL_PTR(type, word)       ((type)(uintptr_t)(word))
#define ACTIVE_PATCH_SLOT0_TRIM   (*(volatile uint32_t *)0xC009BF68u) /* 0xC009BF58 + word 4 (P3: TRIM) */
#define SCRATCH_MAGIC             0x53434E31u                         /* "SCN1" */
#define SMOOTH_ALPHA              0.004166667f                        /* ~5 ms tau at 48 kHz */

typedef struct {
    uint32_t magic;
    float    current_gain;
} SceneScratch;

void Fx_FLT_SCENE(unsigned int *ctx)
{
    /* 25-step -6.0 dB .. +6.0 dB linear gain table (0.5 dB steps, index 12 = 1.0f) */
    static const float TRIM_LUT[25] = {
        0.50118723f, 0.53088444f, 0.56234133f, 0.59566214f, 0.63095734f,
        0.66834392f, 0.70794578f, 0.74989421f, 0.79432823f, 0.84139514f,
        0.89125094f, 0.94406088f, 1.00000000f, 1.05925373f, 1.12201845f,
        1.18850223f, 1.25892541f, 1.33352143f, 1.41253754f, 1.49623566f,
        1.58489319f, 1.67880402f, 1.77827941f, 1.88364909f, 1.99526231f
    };

    float        *fxBuf    = ZDL_PTR(float        *, ctx[5]);
    float        *outBuf   = ZDL_PTR(float        *, ctx[6]);
    SceneScratch *scratch  = ZDL_PTR(SceneScratch *, ctx[3]);

    unsigned int *magicSrc = ZDL_PTR(unsigned int *, ctx[12]);
    unsigned int *magicDst = ZDL_PTR(unsigned int *, *(unsigned int *)ZDL_PTR(unsigned int *, ctx[11]));
    *magicDst = *magicSrc;

    float g = 1.0f;
    if (scratch != (SceneScratch *)0) {
        if (scratch->magic != SCRATCH_MAGIC) {
            scratch->magic = SCRATCH_MAGIC;
            scratch->current_gain = 1.0f;
        }
        g = scratch->current_gain;
    }

    uint32_t trimIdx = ACTIVE_PATCH_SLOT0_TRIM;
    if (trimIdx > 24u) {
        trimIdx = 12u;
    }
    float target = TRIM_LUT[trimIdx];

    int s;
    for (s = 0; s < 8; s++) {
        g += SMOOTH_ALPHA * (target - g);
        outBuf[s]     += fxBuf[s]     * g;
        outBuf[s + 8] += fxBuf[s + 8] * g;
    }

    if (scratch != (SceneScratch *)0) {
        scratch->current_gain = g;
    }
}
