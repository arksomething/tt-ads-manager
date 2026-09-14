import type { CanonicalPubertyEncoderModelSourceV1 } from "../pubertyEncoder";

export const GENERATED_CANONICAL_PUBERTY_ENCODER_MODEL_V1: CanonicalPubertyEncoderModelSourceV1 =
{
  "version": "gotall_puberty_encoder_model_v1",
  "inputVersion": "gotall_puberty_encoder_input_v1",
  "outputVersion": "gotall_puberty_encoder_output_v1",
  "featureVersion": "gotall_puberty_encoder_features_v1",
  "target": "tanner_like_maturity_score",
  "male": {
    "intercept": 2.587799284318905,
    "coefficientsByFeature": {
      "bodyHairStageCentered": 0.5668321930785261,
      "bodyHairPresent": 0,
      "facialHairStageCentered": 0.29663659505663115,
      "facialHairPresent": 0.3011496699850378,
      "voiceChangeStageCentered": 0.20140016172866299,
      "voiceChangePresent": 0.402743729070433,
      "skinChangesStageCentered": 0.11065750968905168,
      "skinChangesPresent": 0,
      "menarcheStartedValue": 0,
      "menarcheStartedPresent": 0,
      "menarcheYearsAgoCentered": 0,
      "menarcheYearsAgoPresent": 0
    }
  },
  "female": {
    "intercept": 2.808899946749305,
    "coefficientsByFeature": {
      "bodyHairStageCentered": 0.12866750519788855,
      "bodyHairPresent": 0,
      "facialHairStageCentered": 0,
      "facialHairPresent": 0,
      "voiceChangeStageCentered": 0,
      "voiceChangePresent": 0,
      "skinChangesStageCentered": 0.2357520769772063,
      "skinChangesPresent": -0.3098328752554421,
      "menarcheStartedValue": 0.6714187879213667,
      "menarcheStartedPresent": 0.3836180128243673,
      "menarcheYearsAgoCentered": 0.5013888207055607,
      "menarcheYearsAgoPresent": 0.5275184003662599
    }
  },
  "maleCalibrationCurve": [
    {
      "ageYears": 12.5,
      "expectedMaturityScore": 2.0753638359610966
    },
    {
      "ageYears": 13,
      "expectedMaturityScore": 2.0965123360438085
    },
    {
      "ageYears": 13.5,
      "expectedMaturityScore": 2.2339398465405473
    },
    {
      "ageYears": 14,
      "expectedMaturityScore": 2.462597963019182
    },
    {
      "ageYears": 14.5,
      "expectedMaturityScore": 2.648167581792853
    },
    {
      "ageYears": 15,
      "expectedMaturityScore": 2.7903634080958177
    },
    {
      "ageYears": 15.5,
      "expectedMaturityScore": 2.8388151526731886
    },
    {
      "ageYears": 16,
      "expectedMaturityScore": 2.906581900231352
    },
    {
      "ageYears": 16.5,
      "expectedMaturityScore": 2.934751878285756
    },
    {
      "ageYears": 17,
      "expectedMaturityScore": 2.9623006204446463
    },
    {
      "ageYears": 17.5,
      "expectedMaturityScore": 3.015307455797906
    },
    {
      "ageYears": 18,
      "expectedMaturityScore": 3.015307455797906
    },
    {
      "ageYears": 18.5,
      "expectedMaturityScore": 3.015307455797906
    },
    {
      "ageYears": 19,
      "expectedMaturityScore": 3.015307455797906
    },
    {
      "ageYears": 19.5,
      "expectedMaturityScore": 3.015307455797906
    },
    {
      "ageYears": 20,
      "expectedMaturityScore": 3.015307455797906
    },
    {
      "ageYears": 21,
      "expectedMaturityScore": 3.3704765934244634
    }
  ],
  "femaleCalibrationCurve": [
    {
      "ageYears": 12,
      "expectedMaturityScore": 3.701880168605059
    },
    {
      "ageYears": 12.5,
      "expectedMaturityScore": 3.701880168605059
    },
    {
      "ageYears": 13,
      "expectedMaturityScore": 3.701880168605059
    },
    {
      "ageYears": 13.5,
      "expectedMaturityScore": 3.7483876641685243
    },
    {
      "ageYears": 14,
      "expectedMaturityScore": 3.925734974687052
    },
    {
      "ageYears": 14.5,
      "expectedMaturityScore": 4.1524885459579535
    },
    {
      "ageYears": 15,
      "expectedMaturityScore": 4.208253988349067
    },
    {
      "ageYears": 15.5,
      "expectedMaturityScore": 4.234888394779445
    },
    {
      "ageYears": 16,
      "expectedMaturityScore": 4.258601346306349
    },
    {
      "ageYears": 16.5,
      "expectedMaturityScore": 4.276711317446562
    },
    {
      "ageYears": 17,
      "expectedMaturityScore": 4.2924585744348045
    },
    {
      "ageYears": 17.5,
      "expectedMaturityScore": 4.2924585744348045
    },
    {
      "ageYears": 18,
      "expectedMaturityScore": 4.2924585744348045
    },
    {
      "ageYears": 18.5,
      "expectedMaturityScore": 4.2924585744348045
    },
    {
      "ageYears": 19,
      "expectedMaturityScore": 4.2924585744348045
    },
    {
      "ageYears": 19.5,
      "expectedMaturityScore": 4.2924585744348045
    },
    {
      "ageYears": 20,
      "expectedMaturityScore": 4.2924585744348045
    }
  ],
  "notes": [
    "Frozen Tanner-like puberty encoder trained from raw Add Health puberty signals.",
    "Ridge lambda=0.5.",
    "Calibration curves are fit from predicted maturity and forced monotonic by age within sex."
  ]
} as CanonicalPubertyEncoderModelSourceV1;
