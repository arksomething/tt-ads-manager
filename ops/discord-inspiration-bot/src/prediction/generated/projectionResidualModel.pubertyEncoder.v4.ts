import type { ProjectionResidualModelSetV4 } from "../projectionResidualModelV4";

export const GENERATED_PUBERTY_ENCODER_PROJECTION_RESIDUAL_MODEL_SET_V4: ProjectionResidualModelSetV4 =
{
  "version": "gotall_projection_residual_model_set_v4",
  "male": {
    "modelId": "gotall_projection_residual_linear_v4",
    "inputVersion": "gotall_projection_model_input_v4",
    "featureVersion": "gotall_projection_residual_features_v4",
    "target": "potential_height_adjustment_cm",
    "interceptCm": 1.876330623191564,
    "clampCm": {
      "min": -3.5,
      "max": 3.5
    },
    "coefficientsCmByFeature": {
      "heightZScore": -3.451631845239707,
      "lateTeenShortfallZScore": -1.5438856406207582,
      "midParentalHeightOffsetDm": 0,
      "weightKgCentered": -0.019900287462773475,
      "sleepHoursCentered": -0.2735421922073337,
      "exerciseHoursCentered": 0.027853479877623016,
      "longitudinalRecentVelocityDeviationScaled": -3.036417072763744,
      "longitudinalPriorVelocityDeviationScaled": -0.465074865755168,
      "longitudinalVelocityDeltaScaled": -6.498582722541099,
      "longitudinalWindowSpanScaled": -0.649613130841012,
      "longitudinalMeasurementCountScaled": -1.17594854739248,
      "longitudinalFitErrorScaled": 0.7020982830205162,
      "longitudinalSparseQualityFlagScaled": -0.48606556363195585,
      "pubertyMaturityScoreScaled": 0,
      "pubertyMaturityResidualForAgeScaled": 0.30706953584977253,
      "pubertyConfidenceScaled": -1.8042111921374113,
      "pubertyResidualConfidenceInteractionScaled": 0
    },
    "notes": [
      "Offline extended frozen-encoder residual model for sex=1.",
      "Ridge lambda=1.",
      "The v4 baseline still blends percentile and mid-parental adult height estimates.",
      "Puberty features come only from the frozen Tanner-like encoder outputs.",
      "midParentalHeightOffsetDm remains a raw centered mid-parental-height input and will stay near zero unless training rows include parent heights."
    ]
  },
  "female": {
    "modelId": "gotall_projection_residual_linear_v4",
    "inputVersion": "gotall_projection_model_input_v4",
    "featureVersion": "gotall_projection_residual_features_v4",
    "target": "potential_height_adjustment_cm",
    "interceptCm": 0.9056337067862799,
    "clampCm": {
      "min": -3.5,
      "max": 3.5
    },
    "coefficientsCmByFeature": {
      "heightZScore": -2.95779522006563,
      "lateTeenShortfallZScore": 0.5499238372778353,
      "midParentalHeightOffsetDm": 0,
      "weightKgCentered": 0.38746768913145146,
      "sleepHoursCentered": 0.22435673253560734,
      "exerciseHoursCentered": 0.0227175485068302,
      "longitudinalRecentVelocityDeviationScaled": -2.74523411013426,
      "longitudinalPriorVelocityDeviationScaled": 0.6688159207799996,
      "longitudinalVelocityDeltaScaled": -3.0879118109641133,
      "longitudinalWindowSpanScaled": -1.3641067782588017,
      "longitudinalMeasurementCountScaled": -0.12034088401971986,
      "longitudinalFitErrorScaled": 0.32749984385190956,
      "longitudinalSparseQualityFlagScaled": 0.4359783625587864,
      "pubertyMaturityScoreScaled": 0,
      "pubertyMaturityResidualForAgeScaled": 1.3721514391028844,
      "pubertyConfidenceScaled": -0.22071536445250126,
      "pubertyResidualConfidenceInteractionScaled": 0
    },
    "notes": [
      "Offline extended frozen-encoder residual model for sex=2.",
      "Ridge lambda=1.",
      "The v4 baseline still blends percentile and mid-parental adult height estimates.",
      "Puberty features come only from the frozen Tanner-like encoder outputs.",
      "midParentalHeightOffsetDm remains a raw centered mid-parental-height input and will stay near zero unless training rows include parent heights."
    ]
  },
  "notes": [
    "Offline extended frozen-encoder model set trained on cohort-harmonized rows.",
    "Each model keeps the stable per-sex ProjectionResidualLinearModelV4 contract."
  ]
} as ProjectionResidualModelSetV4;
