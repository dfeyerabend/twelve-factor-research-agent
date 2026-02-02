import {ChatOpenAI} from "@langchain/openai";

export type LLMConfig = {
    model: string;
    temperature?: number;
    maxTokens?: number;
    apiKey?: string // optional - falls nicht gesetzt, nutzt LangChain automatisch process.env.OPENAI_API_KEY
};

export function createLLM(config: LLMConfig) {
    return new ChatOpenAI({
        model: config.model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens,
        apiKey: config.apiKey, // optional,
    });
}

