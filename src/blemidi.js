// MIDI over Bluetooth Low Energy (the BLE-MIDI spec), read with Web Bluetooth.
export const BLE_MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const BLE_MIDI_CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";

// Data bytes after a status byte; system messages count from 0xf0.
const VOICE_LENGTH = { 8: 2, 9: 2, 10: 2, 11: 2, 12: 1, 13: 1, 14: 2 };
const SYSTEM_LENGTH = { 0xf1: 1, 0xf2: 2, 0xf3: 1 };

// A BLE-MIDI packet is: header byte (bit 7 set, upper timestamp bits), then messages.
// Each message starts with a timestamp byte (bit 7 set) and a status byte. Running status
// leaves out the status byte, and after a complete message even the timestamp byte.
// The parser keeps running status and an open SysEx from one packet to the next.
// It returns plain MIDI messages, [status, data1, data2]; SysEx is skipped.
export function bleMidiParser() {
	let running = 0;
	let sysex = false;
	return (packet) => {
		const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
		const messages = [];
		if (bytes.length < 2 || !(bytes[0] & 0x80)) return messages;
		let i = 1;
		const readData = (status) => {
			const length = status >= 0xf0 ? (SYSTEM_LENGTH[status] ?? 0) : VOICE_LENGTH[status >> 4];
			const data = [];
			while (data.length < length && i < bytes.length && !(bytes[i] & 0x80)) data.push(bytes[i++]);
			if (data.length === length && status < 0xf0) messages.push([status, ...data]);
		};
		while (i < bytes.length) {
			const byte = bytes[i];
			if (sysex) {
				if (!(byte & 0x80)) {
					i++;
					continue;
				}
				const next = bytes[i + 1];
				if (next === 0xf7) {
					sysex = false;
					i += 2;
					continue;
				}
				if (next >= 0xf8) {
					i += 2;
					continue;
				}
				sysex = false;
			}
			if (!(byte & 0x80)) {
				// Running status without a timestamp: the next message follows right after the last.
				if (!running) {
					i++;
					continue;
				}
				readData(running);
				continue;
			}
			// A timestamp byte; what follows is a status byte or, with running status, data.
			i++;
			if (i >= bytes.length) break;
			const status = bytes[i];
			if (!(status & 0x80)) {
				if (running) readData(running);
				else i++;
				continue;
			}
			i++;
			if (status === 0xf0) {
				sysex = true;
				running = 0;
			} else if (status >= 0xf8) {
				// Real-time bytes (clock, start, stop) do not touch running status.
			} else if (status >= 0xf0) {
				running = 0;
				readData(status);
			} else {
				running = status;
				readData(status);
			}
		}
		return messages;
	};
}

// One BLE-MIDI device. onMessage gets plain MIDI messages, onState one of
// "connecting", "connected", "reconnecting" or "off", with the device name.
export class BleMidi {
	device = null;
	#wanted = false;
	#retry = null;
	#parse = bleMidiParser();
	#characteristic = null;
	#onValue = (e) => {
		const view = e.target.value;
		for (const message of this.#parse(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))) this.onMessage(message);
	};

	constructor(onMessage, onState) {
		this.onMessage = onMessage;
		this.onState = onState;
	}

	static get available() {
		return typeof navigator !== "undefined" && !!navigator.bluetooth;
	}

	get name() {
		return this.device?.name || "BLE-MIDI-Gerät";
	}

	// Opens the browser's device chooser; needs a tap.
	async connect() {
		const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }], optionalServices: [BLE_MIDI_SERVICE] });
		if (this.device && this.device !== device) this.disconnect();
		if (this.device !== device) {
			this.device = device;
			device.addEventListener("gattserverdisconnected", () => this.#lost());
		}
		this.#wanted = true;
		this.onState("connecting", this.name);
		try {
			await this.#attach();
		} catch (err) {
			this.#wanted = false;
			this.onState("off", this.name);
			throw err;
		}
	}

	disconnect() {
		this.#wanted = false;
		clearTimeout(this.#retry);
		if (this.device?.gatt.connected) this.device.gatt.disconnect();
		this.onState("off", this.name);
	}

	async #attach() {
		const server = await this.device.gatt.connect();
		const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
		const characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
		this.#parse = bleMidiParser();
		this.#characteristic?.removeEventListener("characteristicvaluechanged", this.#onValue);
		this.#characteristic = characteristic;
		characteristic.addEventListener("characteristicvaluechanged", this.#onValue);
		await characteristic.startNotifications();
		if (!this.#wanted) return this.device.gatt.disconnect();
		this.onState("connected", this.name);
	}

	// The link dropped (device off, out of range): try again, slower each time, until it is back or the user stops.
	#lost(attempt = 0) {
		if (!this.#wanted) return;
		this.onState("reconnecting", this.name);
		clearTimeout(this.#retry);
		this.#retry = setTimeout(async () => {
			if (!this.#wanted || this.device.gatt.connected) return;
			try {
				await this.#attach();
			} catch {
				this.#lost(attempt + 1);
			}
		}, Math.min(1000 * 2 ** attempt, 10_000));
	}
}
