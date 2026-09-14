import type { ProjectionResidualModelSetV3 } from "../projectionResidualModelV3";

export const GENERATED_LONGITUDINAL_PROJECTION_RESIDUAL_MODEL_SET_V3: ProjectionResidualModelSetV3 =
{
  "version": "gotall_projection_residual_model_set_v3",
  "male": {
    "modelId": "gotall_projection_residual_linear_v3",
    "inputVersion": "gotall_projection_model_input_v3",
    "featureVersion": "gotall_projection_residual_features_v3",
    "target": "potential_height_adjustment_cm",
    "interceptCm": 1.0019679475491843,
    "clampCm": {
      "min": -3.5,
      "max": 3.5
    },
    "coefficientsCmByFeature": {
      "heightZScore": -3.480726181905127,
      "lateTeenShortfallZScore": -2.2295214728287576,
      "midParentalHeightOffsetDm": 0,
      "weightKgCentered": -0.09547398062439469,
      "sleepHoursCentered": -0.2847155211946228,
      "exerciseHoursCentered": -0.07912273268828672,
      "longitudinalRecentVelocityDeviationScaled": -2.548660287954799,
      "longitudinalPriorVelocityDeviationScaled": -0.582136663149344,
      "longitudinalVelocityDeltaScaled": -5.977924382289549,
      "longitudinalWindowSpanScaled": 0.3119882402184842,
      "longitudinalMeasurementCountScaled": -0.6895936614131701,
      "longitudinalFitErrorScaled": 0.5289645288058623,
      "longitudinalSparseQualityFlagScaled": -0.5023217629232456,
      "pubertyStageGapScaled": -0.4442163655283069,
      "pubertyGrowthSignalScaled": -4.078076764350374,
      "pubertyTimingEarlyScaled": -1.2990715741329488,
      "pubertyTimingLateScaled": 0.553349359720997,
      "femaleMenarcheRegularScaled": 0,
      "maleLateMarkerScaled": -2.085942585814237
    },
    "notes": [
      "Offline extended residual model for sex=1.",
      "Ridge lambda=1.",
      "The v3 baseline still blends percentile and mid-parental adult height estimates.",
      "Longitudinal features summarize 6-12 month growth windows when repeated measurements exist.",
      "midParentalHeightOffsetDm remains a raw centered mid-parental-height input and will stay near zero unless training rows include parent heights."
    ]
  },
  "female": {
    "modelId": "gotall_projection_residual_linear_v3",
    "inputVersion": "gotall_projection_model_input_v3",
    "featureVersion": "gotall_projection_residual_features_v3",
    "target": "potential_height_adjustment_cm",
    "interceptCm": 0.4570593902423597,
    "clampCm": {
      "min": -3.5,
      "max": 3.5
    },
    "coefficientsCmByFeature": {
      "heightZScore": -2.737413666387273,
      "lateTeenShortfallZScore": 0.7972473779647925,
      "midParentalHeightOffsetDm": 0,
      "weightKgCentered": 0.16133955645343517,
      "sleepHoursCentered": 0.0018122677929831923,
      "exerciseHoursCentered": -0.09026157571715183,
      "longitudinalRecentVelocityDeviationScaled": -3.5531400420962984,
      "longitudinalPriorVelocityDeviationScaled": 0.771273794309855,
      "longitudinalVelocityDeltaScaled": -3.150645893248368,
      "longitudinalWindowSpanScaled": -1.1066891473830847,
      "longitudinalMeasurementCountScaled": -0.006955513722769008,
      "longitudinalFitErrorScaled": 0.3113216942729118,
      "longitudinalSparseQualityFlagScaled": -0.10272194682514811,
      "pubertyStageGapScaled": 2.245990306666636,
      "pubertyGrowthSignalScaled": -0.6836243850950086,
      "pubertyTimingEarlyScaled": -4.6329976972453455,
      "pubertyTimingLateScaled": -1.3303380845354904,
      "femaleMenarcheRegularScaled": 0,
      "maleLateMarkerScaled": 0
    },
    "notes": [
      "Offline extended residual model for sex=2.",
      "Ridge lambda=1.",
      "The v3 baseline still blends percentile and mid-parental adult height estimates.",
      "Longitudinal features summarize 6-12 month growth windows when repeated measurements exist.",
      "midParentalHeightOffsetDm remains a raw centered mid-parental-height input and will stay near zero unless training rows include parent heights."
    ]
  },
  "notes": [
    "Offline extended model set trained on cohort-harmonized rows.",
    "Each model keeps the stable per-sex ProjectionResidualLinearModelV3 contract."
  ]
} as ProjectionResidualModelSetV3;
