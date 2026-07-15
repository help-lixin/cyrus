/**
 * TypeScript interfaces for Weixin event transport.
 *
 * These types mirror the structure of weixin-bot-sdk's ParsedMessage but
 * provide a stable, well-documented interface for the transport layer.
 */

import type {
	InternalMessage,
	SessionStartMessage,
	UserPromptMessage,
} from "cyrus-core";

// Re-export TranslationResult for convenience
export type { TranslationContext, TranslationResult } from "cyrus-core";

/**
 * Parsed message from weixin-bot-sdk's 'message' event.
 * Matches the ParsedMessage interface from weixin-bot-sdk.
 */
export interface WeixinParsedMessage {
	/** Message ID */
	messageId?: number;
	/** User ID who sent the message */
	from: string;
	/** Bot's own user ID */
	to: string;
	/** Message timestamp in milliseconds */
	timestamp?: number;
	/** Context token for reply routing */
	contextToken?: string;
	/** Extracted text content */
	text: string;
	/** Text with quoted context prepended: "[引用: xxx]\ntext" */
	textWithQuote?: string;
	/** Message type */
	type: "text" | "image" | "voice" | "file" | "video";
	/** Image content if type is image */
	image?: WeixinImageItem;
	/** Voice content if type is voice */
	voice?: WeixinVoiceItem;
	/** File content if type is file */
	file?: WeixinFileItem;
	/** Video content if type is video */
	video?: WeixinVideoItem;
	/** Quoted message context */
	quotedMessage?: {
		title?: string;
		item?: WeixinMessageItem;
		text?: string;
	};
	/** Raw Weixin message object from SDK */
	raw: WeixinRawMessage;
}

// ── Weixin SDK Types (mirrored from weixin-bot-sdk types) ──────────────────────

export interface WeixinImageItem {
	media?: WeixinCDNMedia;
	thumb_media?: WeixinCDNMedia;
	aeskey?: string;
	url?: string;
	mid_size?: number;
	thumb_size?: number;
	thumb_height?: number;
	thumb_width?: number;
	hd_size?: number;
}

export interface WeixinVoiceItem {
	media?: WeixinCDNMedia;
	encode_type?: number;
	bits_per_sample?: number;
	sample_rate?: number;
	playtime?: number;
	text?: string;
}

export interface WeixinFileItem {
	media?: WeixinCDNMedia;
	file_name?: string;
	md5?: string;
	len?: string;
}

export interface WeixinVideoItem {
	media?: WeixinCDNMedia;
	video_size?: number;
	play_length?: number;
	video_md5?: string;
	thumb_media?: WeixinCDNMedia;
	thumb_size?: number;
	thumb_height?: number;
	thumb_width?: number;
}

export interface WeixinCDNMedia {
	encrypt_query_param?: string;
	aes_key?: string;
	encrypt_type?: number;
}

export interface WeixinMessageItem {
	type?: number;
	create_time_ms?: number;
	update_time_ms?: number;
	is_completed?: boolean;
	msg_id?: string;
	ref_msg?: { message_item?: WeixinMessageItem; title?: string };
	text_item?: { text?: string };
	image_item?: WeixinImageItem;
	voice_item?: WeixinVoiceItem;
	file_item?: WeixinFileItem;
	video_item?: WeixinVideoItem;
}

export interface WeixinRawMessage {
	seq?: number;
	message_id?: number;
	from_user_id?: string;
	to_user_id?: string;
	client_id?: string;
	create_time_ms?: number;
	update_time_ms?: number;
	delete_time_ms?: number;
	session_id?: string;
	group_id?: string;
	message_type?: number;
	message_state?: number;
	item_list?: WeixinMessageItem[];
	context_token?: string;
}

// ── Platform Reference Types ─────────────────────────────────────────────────

/**
 * Weixin-specific platform reference (mirrors SlackPlatformRef structure).
 */
export interface WeixinPlatformRef {
	channel: {
		/** Weixin is 1:1 only, so "channel" is the user's ID */
		id: string;
	};
	thread: {
		/** No thread concept in Weixin 1:1; use timestamp as thread ID */
		ts: string;
	};
	message: {
		messageId: string;
		text: string;
		user: {
			id: string;
		};
	};
}

// ── Platform Data Types ───────────────────────────────────────────────────────

/**
 * Weixin session start platform data.
 */
export interface WeixinSessionStartPlatformData {
	channel: WeixinPlatformRef["channel"];
	thread: WeixinPlatformRef["thread"];
	message: WeixinPlatformRef["message"];
}

/**
 * Weixin user prompt platform data.
 */
export interface WeixinUserPromptPlatformData {
	channel: WeixinPlatformRef["channel"];
	thread: WeixinPlatformRef["thread"];
	message: WeixinPlatformRef["message"];
}

// ── Transport Configuration ─────────────────────────────────────────────────

/**
 * Configuration for WeixinEventTransport.
 */
export interface WeixinEventTransportConfig {
	/**
	 * Path to credentials file for Weixin bot.
	 * The weixin-bot-sdk saves login credentials here (bot token, etc.).
	 * Defaults to ~/.cyrus/weixin-credentials.json if not specified.
	 */
	credentialsPath: string;

	/**
	 * Callback for QR code data URL during login.
	 * The data URL can be displayed in terminal or saved as an image.
	 */
	onQrCode?: (qrCodeDataUrl: string) => void;

	/**
	 * Callback for login status changes.
	 * Status values: 'wait' | 'scaned' | 'confirmed' | 'expired'
	 */
	onStatus?: (status: string) => void;

	/**
	 * Login timeout in milliseconds.
	 * @default 120000 (2 minutes)
	 */
	timeoutMs?: number;

	/**
	 * Enable verbose logging for SDK internals.
	 * @default false
	 */
	verbose?: boolean;
}

// ── Event Types ───────────────────────────────────────────────────────────────

/**
 * Events emitted by WeixinEventTransport.
 */
export interface WeixinEventTransportEvents {
	/** Emitted when transport is connected and polling */
	ready: () => void;
	/** Emitted when a translated message is ready for processing */
	message: (message: InternalMessage) => void;
	/** Emitted when a raw parsed message is received (before translation) */
	rawEvent: (event: WeixinParsedMessage) => void;
	/** Emitted on polling error */
	error: (error: Error) => void;
	/** Emitted when Weixin session expires (token invalid) */
	sessionExpired: () => void;
	/** Emitted when credentials are loaded from file */
	credentialsLoaded: (credentials: WeixinCredentials) => void;
	/** Emitted when bot stops */
	stop: () => void;
}

// ── Credentials ─────────────────────────────────────────────────────────────

/**
 * Credentials loaded/saved by weixin-bot-sdk.
 */
export interface WeixinCredentials {
	botToken: string;
	botId?: string;
	baseUrl?: string;
	userId?: string;
	savedAt?: string;
}

// ── Internal Message Helpers ─────────────────────────────────────────────────

/**
 * Check if a message is a SessionStartMessage.
 */
export function isSessionStartMessage(
	msg: InternalMessage,
): msg is SessionStartMessage {
	return msg.action === "session_start";
}

/**
 * Check if a message is a UserPromptMessage.
 */
export function isUserPromptMessage(
	msg: InternalMessage,
): msg is UserPromptMessage {
	return msg.action === "user_prompt";
}
