/**
 * Internal Message Bus
 *
 * This module exports all types and utilities for the internal message bus
 * that provides a unified interface for handling events from multiple
 * webhook sources (Linear, GitHub, Slack, etc.).
 *
 * @module messages
 */

// Translator interface
export type {
	IMessageTranslator,
	TranslationContext,
	TranslationResult,
} from "./IMessageTranslator.js";

// Platform reference types
export type {
	DingtalkPlatformRef,
	GitHubPlatformRef,
	GitLabPlatformRef,
	LarkPlatformRef,
	LinearPlatformRef,
	QQPlatformRef,
	SlackPlatformRef,
	WeixinPlatformRef,
} from "./platform-refs.js";

// Type guards
export {
	hasDingtalkSessionStartPlatformData,
	hasDingtalkUserPromptPlatformData,
	hasGitHubSessionStartPlatformData,
	hasGitHubUserPromptPlatformData,
	hasGitLabSessionStartPlatformData,
	hasGitLabUserPromptPlatformData,
	hasLarkSessionStartPlatformData,
	hasLarkUserPromptPlatformData,
	hasLinearSessionStartPlatformData,
	hasLinearUserPromptPlatformData,
	hasQQSessionStartPlatformData,
	hasQQUserPromptPlatformData,
	hasSlackSessionStartPlatformData,
	hasSlackUserPromptPlatformData,
	isContentUpdateMessage,
	isDingtalkMessage,
	isGitHubMessage,
	isGitLabMessage,
	isIssueStateChangeMessage,
	isLarkMessage,
	isLinearMessage,
	isQQMessage,
	isSessionStartMessage,
	isSlackMessage,
	isStopSignalMessage,
	isUnassignMessage,
	isUserPromptMessage,
} from "./type-guards.js";
// Core message types
export type {
	ContentChanges,
	ContentUpdateMessage,
	// DingTalk platform data types
	DingtalkSessionStartPlatformData,
	DingtalkUserPromptPlatformData,
	GitHubSessionStartPlatformData,
	GitHubUserPromptPlatformData,
	// GitLab platform data types
	GitLabSessionStartPlatformData,
	GitLabUserPromptPlatformData,
	GuidanceItem,
	InternalMessage,
	InternalMessageBase,
	IssueStateChangeMessage,
	// Lark platform data types
	LarkSessionStartPlatformData,
	LarkUserPromptPlatformData,
	LinearContentUpdatePlatformData,
	LinearIssueStateChangePlatformData,
	// Platform-specific data types
	LinearSessionStartPlatformData,
	LinearStopSignalPlatformData,
	LinearUnassignPlatformData,
	LinearUserPromptPlatformData,
	MessageAction,
	MessageAuthor,
	MessageSource,
	// QQ platform data types
	QQSessionStartPlatformData,
	QQUserPromptPlatformData,
	SessionStartMessage,
	// Slack platform data types
	SlackSessionStartPlatformData,
	SlackUserPromptPlatformData,
	StopSignalMessage,
	UnassignMessage,
	UserPromptMessage,
	// Weixin platform data types
	WeixinSessionStartPlatformData,
	WeixinUserPromptPlatformData,
} from "./types.js";
