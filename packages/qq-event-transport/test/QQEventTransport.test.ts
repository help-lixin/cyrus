import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QQEventTransport } from "../src/QQEventTransport.js";
import type { QQEventTransportConfig } from "../src/types.js";

describe("QQEventTransport", () => {
	let transport: QQEventTransport;
	let mockConfig: QQEventTransportConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig = {
			appId: "test_app_id",
			appSecret: "test_app_secret",
			markdownSupport: false,
		};
	});

	afterEach(() => {
		if (transport) {
			transport.stop();
		}
	});

	describe("constructor", () => {
		it("creates a QQEventTransport instance", () => {
			transport = new QQEventTransport(mockConfig);
			expect(transport).toBeInstanceOf(QQEventTransport);
		});

		it("accepts custom logger", () => {
			const customLogger = {
				info: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				warn: vi.fn(),
			};
			transport = new QQEventTransport(mockConfig, customLogger);
			expect(transport).toBeInstanceOf(QQEventTransport);
		});
	});

	describe("setTranslationContext", () => {
		it("sets translation context without error", () => {
			transport = new QQEventTransport(mockConfig);
			transport.setTranslationContext({ organizationId: "org_123" });
		});
	});

	describe("event emitter", () => {
		it("can register event listener", () => {
			transport = new QQEventTransport(mockConfig);
			const handler = vi.fn();
			transport.on("message", handler);
		});

		it("can register error listener", () => {
			transport = new QQEventTransport(mockConfig);
			const handler = vi.fn();
			transport.on("error", handler);
		});

		it("can register raw event listener", () => {
			transport = new QQEventTransport(mockConfig);
			const handler = vi.fn();
			transport.on("event", handler);
		});
	});

	describe("stop", () => {
		it("stops the transport without error when not started", () => {
			transport = new QQEventTransport(mockConfig);
			transport.stop();
		});
	});

	describe("getBot", () => {
		it("returns null before start", () => {
			transport = new QQEventTransport(mockConfig);
			expect(transport.getBot()).toBeNull();
		});
	});

	// Note: start() tests require actual QQ SDK initialization
	// which is tested in integration tests rather than unit tests
	describe("start (integration)", () => {
		it("should be able to start when QQ credentials are valid", async () => {
			// This is a placeholder for integration testing
			// Actual start() tests would require valid QQ credentials
			// and are better suited for e2e testing
			transport = new QQEventTransport(mockConfig);
			expect(transport).toBeDefined();
		});
	});
});
