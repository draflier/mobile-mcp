import path from "node:path";
import { execFileSync } from "node:child_process";

import * as xml from "fast-xml-parser";

import { ActionableError, Button, InstalledApp, Robot, ScreenElement, ScreenElementRect, ScreenSize, SwipeDirection, Orientation } from "./robot";

export interface AndroidDevice {
	deviceId: string;
	deviceType: "tv" | "mobile";
}

interface UiAutomatorXmlNode {
	node: UiAutomatorXmlNode[];
	class?: string;
	text?: string;
	bounds?: string;
	hint?: string;
	focused?: string;
	"content-desc"?: string;
	"resource-id"?: string;
}

interface UiAutomatorXml {
	hierarchy: {
		node: UiAutomatorXmlNode;
	};
}

const getAdbPath = (): string => {
	let executable = "adb";
	if (process.env.ANDROID_HOME) {
		executable = path.join(process.env.ANDROID_HOME, "platform-tools", "adb");
	}

	return executable;
};

const BUTTON_MAP: Record<Button, string> = {
	"BACK": "KEYCODE_BACK",
	"HOME": "KEYCODE_HOME",
	"VOLUME_UP": "KEYCODE_VOLUME_UP",
	"VOLUME_DOWN": "KEYCODE_VOLUME_DOWN",
	"ENTER": "KEYCODE_ENTER",
	"DPAD_CENTER": "KEYCODE_DPAD_CENTER",
	"DPAD_UP": "KEYCODE_DPAD_UP",
	"DPAD_DOWN": "KEYCODE_DPAD_DOWN",
	"DPAD_LEFT": "KEYCODE_DPAD_LEFT",
	"DPAD_RIGHT": "KEYCODE_DPAD_RIGHT",
};

const TIMEOUT = 30000;
const MAX_BUFFER_SIZE = 1024 * 1024 * 4;

type AndroidDeviceType = "tv" | "mobile";

export class AndroidRobot implements Robot {

	public constructor(private deviceId: string) {
	}

	public adb(...args: string[]): Buffer {
		return execFileSync(getAdbPath(), ["-s", this.deviceId, ...args], {
			maxBuffer: MAX_BUFFER_SIZE,
			timeout: TIMEOUT,
		});
	}

	public getSystemFeatures(): string[] {
		return this.adb("shell", "pm", "list", "features")
			.toString()
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.startsWith("feature:"))
			.map(line => line.substring("feature:".length));
	}

	public async getScreenSize(): Promise<ScreenSize> {
		const screenSize = this.adb("shell", "wm", "size")
			.toString()
			.split(" ")
			.pop();

		if (!screenSize) {
			throw new Error("Failed to get screen size");
		}

		const scale = 1;
		const [width, height] = screenSize.split("x").map(Number);
		return { width, height, scale };
	}

	public async listApps(): Promise<InstalledApp[]> {
		// only apps that have a launcher activity are returned
		return this.adb("shell", "cmd", "package", "query-activities", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER")
			.toString()
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.startsWith("packageName="))
			.map(line => line.substring("packageName=".length))
			.filter((value, index, self) => self.indexOf(value) === index)
			.map(packageName => ({
				packageName,
				appName: packageName,
			}));
	}

	private async listPackages(): Promise<string[]> {
		return this.adb("shell", "pm", "list", "packages")
			.toString()
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.startsWith("package:"))
			.map(line => line.substring("package:".length));
	}

	public async launchApp(packageName: string): Promise<void> {
		this.adb("shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1");
	}

	public async listRunningProcesses(): Promise<string[]> {
		return this.adb("shell", "ps", "-e")
			.toString()
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.startsWith("u")) // non-system processes
			.map(line => line.split(/\s+/)[8]); // get process name
	}

	public async swipe(direction: SwipeDirection): Promise<void> {
		const screenSize = await this.getScreenSize();
		const centerX = screenSize.width >> 1;

		let x0: number, y0: number, x1: number, y1: number;

		switch (direction) {
			case "up":
				x0 = x1 = centerX;
				y0 = Math.floor(screenSize.height * 0.80);
				y1 = Math.floor(screenSize.height * 0.20);
				break;
			case "down":
				x0 = x1 = centerX;
				y0 = Math.floor(screenSize.height * 0.20) + 300;
				y1 = Math.floor(screenSize.height * 0.80) + 300;
				break;
			case "left":
				x0 = Math.floor(screenSize.width * 0.80);
				x1 = Math.floor(screenSize.width * 0.20);
				y0 = y1 = Math.floor(screenSize.height * 0.50);
				break;
			case "right":
				x0 = Math.floor(screenSize.width * 0.20);
				x1 = Math.floor(screenSize.width * 0.80);
				y0 = y1 = Math.floor(screenSize.height * 0.50);
				break;
			default:
				throw new ActionableError(`Swipe direction "${direction}" is not supported`);
		}
		console.log(`Swiping from (${x0}, ${y0}) to (${x1}, ${y1}) in direction "${direction}"`);

		this.adb("shell", "input", "swipe", `${x0}`, `${y0}`, `${x1}`, `${y1}`, "1000");
	}

	public async swipeFromCoordinate(x: number, y: number, direction: SwipeDirection, distance?: number): Promise<void> {
		const screenSize = await this.getScreenSize();

		let x0: number, y0: number, x1: number, y1: number;

		// Use provided distance or default to 30% of screen dimension
		const defaultDistanceY = Math.floor(screenSize.height * 0.3);
		const defaultDistanceX = Math.floor(screenSize.width * 0.3);
		const swipeDistanceY = distance || defaultDistanceY;
		const swipeDistanceX = distance || defaultDistanceX;

		switch (direction) {
			case "up":
				x0 = x1 = x;
				y0 = y;
				y1 = Math.max(0, y - swipeDistanceY);
				break;
			case "down":
				x0 = x1 = x;
				y0 = y;
				y1 = Math.min(screenSize.height, y + swipeDistanceY);
				break;
			case "left":
				x0 = x;
				x1 = Math.max(0, x - swipeDistanceX);
				y0 = y1 = y;
				break;
			case "right":
				x0 = x;
				x1 = Math.min(screenSize.width, x + swipeDistanceX);
				y0 = y1 = y;
				break;
			default:
				throw new ActionableError(`Swipe direction "${direction}" is not supported`);
		}

		this.adb("shell", "input", "swipe", `${x0}`, `${y0}`, `${x1}`, `${y1}`, "1000");
	}

	public async getScreenshot(): Promise<Buffer> {
		return this.adb("exec-out", "screencap", "-p");
	}

	private collectElements(node: UiAutomatorXmlNode): ScreenElement[] {
		const elements: Array<ScreenElement> = [];

		if (node.node) {
			if (Array.isArray(node.node)) {
				for (const childNode of node.node) {
					elements.push(...this.collectElements(childNode));
				}
			} else {
				elements.push(...this.collectElements(node.node));
			}
		}

		if (node.text || node["content-desc"] || node.hint) {
			const element: ScreenElement = {
				type: node.class || "text",
				text: node.text,
				label: node["content-desc"] || node.hint || "",
				rect: this.getScreenElementRect(node),
			};

			if (node.focused === "true") {
				// only provide it if it's true, otherwise don't confuse llm
				element.focused = true;
			}

			const resourceId = node["resource-id"];
			if (resourceId !== null && resourceId !== "") {
				element.identifier = resourceId;
			}

			if (element.rect.width > 0 && element.rect.height > 0) {
				elements.push(element);
			}
		}

		return elements;
	}

	public async getElementsOnScreen(): Promise<ScreenElement[]> {
		const parsedXml = await this.getUiAutomatorXml();
		const hierarchy = parsedXml.hierarchy;
		const elements = this.collectElements(hierarchy.node);
		return elements;
	}

	public async terminateApp(packageName: string): Promise<void> {
		this.adb("shell", "am", "force-stop", packageName);
	}

	/**
	 * Books a badminton court in the soprop app.
	 * @param date The date for booking (format must be "22 Jul 2025").
	 * @param startTimeSlot The starting time slot for booking (format: HH:mm).
	 * @param endTimeSlot The ending time slot for booking (format: HH:mm).
	 * @returns Promise<void>
	 * @throws ActionableError if booking fails.
	 */
	public async bookBadmintonCourt(date: string, startTimeSlot: string, endTimeSlot: string): Promise<void> {
		const packageName = "com.hongyip.soprop.app"; // Package name for soprop app
		await this.launchApp(packageName);
		
		// Wait for the app to load
		await new Promise(resolve => setTimeout(resolve, 5000));
		
		// Navigate to booking section
		await this.tap(100, 1000); // Tap on a general area to ensure app focus
		
		// Wait for booking page to load
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Click on the badminton tab
		await this.tap(570, 741); // Tap Badminton tab
		// Wait for tab content to load
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Click on the Badminton(1) option
		await this.tap(510, 953); // Tap Badminton(1)
		// Wait for selection to load
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Click on the date field to open the calendar
		await this.tap(510, 679); // Tap on the date field (center of the date TextView)
		// Wait for calendar to open
		await new Promise(resolve => setTimeout(resolve, 2000));

		// Select the calender selector element
		let elements = await this.getElementsOnScreen();
		let calSelector = elements.find(el => el.identifier?.includes("tv_selected_date"));
		if (!calSelector) {
			throw new ActionableError("Could not find calendar selector element");
		}
		else
		{
			// Tap on the calendar selector to open the date picker
			await this.tap(
				calSelector.rect.x + calSelector.rect.width / 2,
				calSelector.rect.y + calSelector.rect.height / 2
			);
		}

		elements = await this.getElementsOnScreen();
		let dateElement = elements.find(el => el.identifier?.includes(date));
		if (!dateElement) {
			throw new ActionableError("Could not find calendar selector element");
		}
		else
		{
			// Tap on the calendar selector to open the date picker
			await this.tap(
				dateElement.rect.x + dateElement.rect.width / 2,
				dateElement.rect.y + dateElement.rect.height / 2
			);
		}



		// Confirm date selection by clicking OK button
		await this.tap(540, 1808); // Tap OK button (assumed coordinates)
		// Wait for calendar to close and date to update
		await new Promise(resolve => setTimeout(resolve, 2000));

		// Look for the desired time slot
		let maxSwipes = 5; // Prevent infinite swiping
		let swipeCount = 0;
		let timeSlotFound = false;
		// Format the target time slot text as "HH:mm - HH:mm"
		const startFormatted = startTimeSlot.includes(":") ? startTimeSlot : `${startTimeSlot}:00`;
		const endFormatted = endTimeSlot.includes(":") ? endTimeSlot : `${endTimeSlot}:00`;
		const targetTimeSlotText = `${startFormatted} - ${endFormatted}`;

		while (!timeSlotFound && swipeCount < maxSwipes) {
			const elements = await this.getElementsOnScreen();
			const timeSlotElement = elements.find(el => 
				el.text?.includes(targetTimeSlotText) || el.label?.includes(targetTimeSlotText)
			);

			if (timeSlotElement) {
				// Time slot found, tap on it
				await this.tap(
					timeSlotElement.rect.x + timeSlotElement.rect.width / 2,
					timeSlotElement.rect.y + timeSlotElement.rect.height / 2
				);
				timeSlotFound = true;
				break;
			} else {
				// Time slot not found, swipe up to see more
				await this.swipe("up");
				swipeCount++;
				// Wait for swipe to complete
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}

		if (!timeSlotFound) {
			throw new ActionableError(`Could not find time slot ${targetTimeSlotText} after ${maxSwipes} swipes`);
		}
	}

	public async openUrl(url: string): Promise<void> {
		this.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url);
	}

	private isAscii(text: string): boolean {
		return /^[\x00-\x7F]*$/.test(text);
	}

	private async isDeviceKitInstalled(): Promise<boolean> {
		const packages = await this.listPackages();
		return packages.includes("com.mobilenext.devicekit");
	}

	public async sendKeys(text: string): Promise<void> {
		if (text === "") {
			// bailing early, so we don't run adb shell with empty string.
			// this happens when you prompt with a simple "submit".
			return;
		}

		if (this.isAscii(text)) {
			// adb shell input only supports ascii characters. and
			// some of the keys have to be escaped.
			const _text = text.replace(/ /g, "\\ ");
			this.adb("shell", "input", "text", _text);
		} else if (await this.isDeviceKitInstalled()) {
			// try sending over clipboard
			const base64 = Buffer.from(text).toString("base64");

			// send clipboard over and immediately paste it
			this.adb("shell", "am", "broadcast", "-a", "devicekit.clipboard.set", "-e", "encoding", "base64", "-e", "text", base64, "-n", "com.mobilenext.devicekit/.ClipboardBroadcastReceiver");
			this.adb("shell", "input", "keyevent", "KEYCODE_PASTE");

			// clear clipboard when we're done
			this.adb("shell", "am", "broadcast", "-a", "devicekit.clipboard.clear", "-n", "com.mobilenext.devicekit/.ClipboardBroadcastReceiver");
		} else {
			throw new ActionableError("Non-ASCII text is not supported on Android, please install mobilenext devicekit, see https://github.com/mobile-next/devicekit-android");
		}
	}

	public async pressButton(button: Button) {
		if (!BUTTON_MAP[button]) {
			throw new ActionableError(`Button "${button}" is not supported`);
		}

		this.adb("shell", "input", "keyevent", BUTTON_MAP[button]);
	}

	public async tap(x: number, y: number): Promise<void> {
		this.adb("shell", "input", "tap", `${x}`, `${y}`);
	}

	public async setOrientation(orientation: Orientation): Promise<void> {
		const orientationValue = orientation === "portrait" ? 0 : 1;

		// disable auto-rotation prior to setting the orientation
		this.adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
		this.adb("shell", "content", "insert", "--uri", "content://settings/system", "--bind", "name:s:user_rotation", "--bind", `value:i:${orientationValue}`);
	}

	public async getOrientation(): Promise<Orientation> {
		const rotation = this.adb("shell", "settings", "get", "system", "user_rotation").toString().trim();
		return rotation === "0" ? "portrait" : "landscape";
	}

	private async getUiAutomatorDump(): Promise<string> {
		for (let tries = 0; tries < 10; tries++) {
			const dump = this.adb("exec-out", "uiautomator", "dump", "/dev/tty").toString();
			// note: we're not catching other errors here. maybe we should check for <?xml
			if (dump.includes("null root node returned by UiTestAutomationBridge")) {
				// uncomment for debugging
				// const screenshot = await this.getScreenshot();
				// console.error("Failed to get UIAutomator XML. Here's a screenshot: " + screenshot.toString("base64"));
				continue;
			}

			return dump.substring(dump.indexOf("<?xml"));
		}

		throw new ActionableError("Failed to get UIAutomator XML");
	}

	private async getUiAutomatorXml(): Promise<UiAutomatorXml> {
		const dump = await this.getUiAutomatorDump();
		const parser = new xml.XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: "",
		});

		return parser.parse(dump) as UiAutomatorXml;
	}

	private getScreenElementRect(node: UiAutomatorXmlNode): ScreenElementRect {
		const bounds = String(node.bounds);

		const [, left, top, right, bottom] = bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.map(Number) || [];
		return {
			x: left,
			y: top,
			width: right - left,
			height: bottom - top,
		};
	}
}

export class AndroidDeviceManager {

	private getDeviceType(name: string): AndroidDeviceType {
		const device = new AndroidRobot(name);
		const features = device.getSystemFeatures();
		if (features.includes("android.software.leanback") || features.includes("android.hardware.type.television")) {
			return "tv";
		}

		return "mobile";
	}

	public getConnectedDevices(): AndroidDevice[] {
		try {
			const names = execFileSync(getAdbPath(), ["devices"])
				.toString()
				.split("\n")
				.map(line => line.trim())
				.filter(line => line !== "")
				.filter(line => !line.startsWith("List of devices attached"))
				.map(line => line.split("\t")[0]);

			return names.map(name => ({
				deviceId: name,
				deviceType: this.getDeviceType(name),
			}));
		} catch (error) {
			console.error("Could not execute adb command, maybe ANDROID_HOME is not set?");
			return [];
		}
	}
}
