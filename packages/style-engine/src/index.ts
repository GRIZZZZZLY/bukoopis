export {
  parseReference,
  parseTxt,
  parseMd,
  parseFb2,
  parseEpub,
  splitIntoScenes,
  detectFormat,
  type ParsedReference,
} from "./parsers.js";
export { detectFatigueWords } from "./fatigue.js";
export {
  computeCorpusMetrics,
  computeSentenceLengths,
  computeDialogueShare,
  composeDensity,
  renderCorpusMetrics,
  countWords,
  splitSentences,
  type CorpusMetrics,
} from "./metrics.js";
export {
  runStyleExtractor,
  registerStyleExtractorContract,
  type StyleExtractInput,
} from "./extractor.js";
export {
  runStyleBlender,
  registerStyleBlenderContract,
  blendNumericStats,
  normalizeWeights,
  type StyleBlendInput,
  type BlendParent,
  type BlendNumericStats,
} from "./blender.js";
