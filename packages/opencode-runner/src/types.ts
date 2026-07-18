import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

export interface OpenCodeRunnerConfig extends AgentRunnerConfig {
	opencodeServerUrl?: string;
}

export interface OpenCodeSessionInfo extends AgentSessionInfo {
	sessionId: string | null;
}

export interface OpenCodeRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
}
