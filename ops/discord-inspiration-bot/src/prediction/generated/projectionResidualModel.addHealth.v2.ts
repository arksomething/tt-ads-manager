import type { ProjectionResidualModelSetV2 } from "../projectionResidualModelV2";

export const GENERATED_ADD_HEALTH_PROJECTION_RESIDUAL_MODEL_SET_V2: ProjectionResidualModelSetV2 =
{
  "version": "gotall_projection_residual_model_set_v2",
  "male": {
    "modelId": "gotall_projection_residual_linear_v2",
    "inputVersion": "gotall_projection_model_input_v2",
    "featureVersion": "gotall_projection_residual_features_v2",
    "target": "potential_height_adjustment_cm",
    "interceptCm": 1.4046414500724367,
    "clampCm": {
      "min": -3.5,
      "max": 3.5
    },
    "coefficientsCmByFeature": {
      "heightZScore": -3.648104721317905,
      "lateTeenShortfallZScore": -2.4460860895117738,
      "midParentalHeightOffsetDm": 0,
      "weightKgCentered": -0.026953526305291214,
      "sleepHoursCentered": -0.18768954751286648,
      "exerciseHoursCentered": -0.09268130952496798,
      "measuredGrowthVelocityDeviationScaled": -1.4610780742712444,
      "pubertyStageGapScaled": -0.5976285414387693,
      "pubertyGrowthSignalScaled": -4.820116692308598,
      "pubertyTimingEarlyScaled": -1.6238338994127794,
      "pubertyTimingLateScaled": 0.23620910443728535,
      "femaleMenarcheRegularScaled": 0,
      "maleLateMarkerScaled": -2.5993554083209545
    },
    "notes": [
      "Offline extended residual model for sex=1.",
      "Ridge lambda=1.",
      "The v2 baseline already blends percentile and mid-parental adult height estimates.",
      "The lateTeenShortfallZScore feature dampens shorter-than-average late-teen catch-up without relying on runtime-only clipping.",
      "midParentalHeightOffsetDm remains a raw centered mid-parental-height input and will stay near zero unless training rows include parent heights."
    ]
  },
  "female": {
    "modelId": "gotall_projection_residual_linear_v2",
    "inputVersion": "gotall_projection_model_input_v2",
    "featureVersion": "gotall_projection_residual_features_v2",
    "target": "potential_height_adjustment_cm",
    "interceptCm": -0.025508631192708957,
    "clampCm": {
      "min": -3.5,
      "max": 3.5
    },
    "coefficientsCmByFeature": {
      "heightZScore": -2.942216545295074,
      "lateTeenShortfallZScore": 0.9737528684274847,
      "midParentalHeightOffsetDm": 0,
      "weightKgCentered": 0.15347316452518245,
      "sleepHoursCentered": -0.12802273313984208,
      "exerciseHoursCentered": 0.10117385153246165,
      "measuredGrowthVelocityDeviationScaled": -0.740958962791586,
      "pubertyStageGapScaled": 1.748520051747497,
      "pubertyGrowthSignalScaled": -2.4153329657156055,
      "pubertyTimingEarlyScaled": -4.945944993958549,
      "pubertyTimingLateScaled": -0.6857650722018175,
      "femaleMenarcheRegularScaled": 0,
      "maleLateMarkerScaled": 0
    },
    "notes": [
      "Offline extended residual model for sex=2.",
      "Ridge lambda=1.",
      "The v2 baseline already blends percentile and mid-parental adult height estimates.",
      "The lateTeenShortfallZScore feature dampens shorter-than-average late-teen catch-up without relying on runtime-only clipping.",
      "midParentalHeightOffsetDm remains a raw centered mid-parental-height input and will stay near zero unless training rows include parent heights."
    ]
  },
  "notes": [
    "Offline extended model set trained on cohort-harmonized rows.",
    "Each model keeps the stable per-sex ProjectionResidualLinearModelV2 contract."
  ]
} as ProjectionResidualModelSetV2;
