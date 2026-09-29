// Model adapter factory. The rest of the code only calls model.complete().

import { createOpenAICompatibleModel } from './openaiCompatible.js';
import { createRuleBasedMock } from './mock.js';

export function createModel(modelConfig) {
  if (modelConfig.provider === 'mock') return createRuleBasedMock();
  if (!modelConfig.baseUrl) throw new Error('MODEL_BASE_URL is required for MODEL_PROVIDER=openai-compatible.');
  return createOpenAICompatibleModel(modelConfig);
}
