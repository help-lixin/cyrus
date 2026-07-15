/**
 * weixin-slack-event-transport - WeChat/Weixin event transport for Cyrus
 *
 * This package integrates weixin-bot-sdk with the Cyrus EdgeWorker system,
 * providing long-polling based message reception for WeChat 1:1 conversations.
 */

// Re-export TranslationResult for convenience
export type { TranslationContext, TranslationResult } from "cyrus-core";
// Types
export type {
	WeixinCDNMedia,
	WeixinCredentials,
	WeixinEventTransportConfig,
	WeixinEventTransportEvents,
	WeixinFileItem,
	WeixinImageItem,
	WeixinMessageItem,
	WeixinParsedMessage,
	WeixinPlatformRef,
	WeixinRawMessage,
	WeixinSessionStartPlatformData,
	WeixinUserPromptPlatformData,
	WeixinVideoItem,
	WeixinVoiceItem,
} from "./types.js";
// Main transport class
export { WeixinEventTransport } from "./WeixinEventTransport.js";
// Message service for sending replies
export { WeixinMessageService } from "./WeixinMessageService.js";
// Message translator
export { WeixinMessageTranslator } from "./WeixinMessageTranslator.js";
