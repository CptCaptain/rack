// Reports the newest sample of its input to the page about 85 times a second,
// so the page can move a knob with a signal.
registerProcessor(
	"tap",
	class extends AudioWorkletProcessor {
		constructor() {
			super();
			this.blocks = 0;
			this.port.onmessage = () => (this.stopped = true);
		}

		process([input]) {
			if (input[0] && ++this.blocks % 4 === 0) this.port.postMessage(input[0].at(-1));
			return !this.stopped;
		}
	},
);
