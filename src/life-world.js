// A small world for the Leben module: creatures look for food, pay energy to live,
// split into two when they have plenty, and starve when they run out. When the last one
// dies, a single creature that fits the current climate is born a moment later. A child inherits
// its parent's genes with small random changes, so the population adapts to the environment.
export const WIDTH = 100;
export const HEIGHT = 60;
export const MAX_CREATURES = 80;
const MAX_FOOD = 120;
const EXTINCT_STEPS = 120;
// Tuned by simulation (see scripts/probe.mjs): with these, a population follows a slowly
// changing climate when mutation is on and falls behind when it is off.
const FOOD_PER_STEP = 2;
const CLIMATE_COST = 0.15;
const MUTATION_STEP = 0.4;
// Each gene's range. warmth is the climate a creature is built for.
const GENES = { speed: [0.3, 2], sense: [3, 25], warmth: [0, 1] };

// The first creature after an extinction. Its speed is where populations settled in the
// tuning runs (1.4 to 1.9), its sight is the middle of the range.
const PIONEER = { speed: 1.5, sense: 14 };

const wrap = (d, size) => (d > size / 2 ? d - size : d < -size / 2 ? d + size : d);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

export class World {
	constructor(seed = Date.now()) {
		// mulberry32: small, fast, and repeatable for a given seed.
		let a = seed >>> 0;
		this.random = () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), a | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		this.populate();
	}

	populate() {
		const anywhere = () => ({ x: this.random() * WIDTH, y: this.random() * HEIGHT });
		const gene = ([lo, hi]) => lo + this.random() * (hi - lo);
		this.food = Array.from({ length: 40 }, anywhere);
		this.creatures = Array.from({ length: 12 }, () => ({ ...anywhere(), dir: 0, energy: 1, speed: gene(GENES.speed), sense: gene(GENES.sense), warmth: gene(GENES.warmth) }));
		this.foodDue = 0;
		this.empty = 0;
	}

	// One moment of the world. env has food, climate and mutation, each 0..1.
	// Returns the warmth gene of every creature born and the number that died.
	step(env) {
		const births = [];
		let deaths = 0;
		for (this.foodDue += env.food * FOOD_PER_STEP; this.foodDue >= 1; this.foodDue--)
			if (this.food.length < MAX_FOOD) this.food.push({ x: this.random() * WIDTH, y: this.random() * HEIGHT });

		for (const c of [...this.creatures]) {
			let nearest = -1;
			let best = c.sense ** 2;
			let toward = 0;
			for (const [i, f] of this.food.entries()) {
				const dx = wrap(f.x - c.x, WIDTH);
				const dy = wrap(f.y - c.y, HEIGHT);
				if (dx * dx + dy * dy < best) [nearest, best, toward] = [i, dx * dx + dy * dy, Math.atan2(dy, dx)];
			}
			c.dir = nearest < 0 ? c.dir + (this.random() - 0.5) * 0.6 : toward;
			if (nearest >= 0 && Math.sqrt(best) <= c.speed + 1) {
				Object.assign(c, this.food[nearest]);
				this.food[nearest] = this.food.at(-1);
				this.food.pop();
				c.energy += 0.5;
			} else {
				c.x = (c.x + Math.cos(c.dir) * c.speed + WIDTH) % WIDTH;
				c.y = (c.y + Math.sin(c.dir) * c.speed + HEIGHT) % HEIGHT;
			}
			// Living costs energy: moving fast, seeing far, and most of all the wrong climate.
			c.energy -= 0.004 + 0.006 * c.speed ** 2 + 0.0002 * c.sense + CLIMATE_COST * (c.warmth - env.climate) ** 2;
			if (c.energy <= 0) {
				this.creatures.splice(this.creatures.indexOf(c), 1);
				deaths++;
			} else if (c.energy > 2 && this.creatures.length < MAX_CREATURES) {
				c.energy /= 2;
				const child = { ...c };
				for (const [name, range] of Object.entries(GENES)) {
					const nudge = this.random() + this.random() + this.random() - 1.5;
					child[name] = clamp(c[name] + nudge * env.mutation * MUTATION_STEP * (range[1] - range[0]), range);
				}
				this.creatures.push(child);
				births.push(child.warmth);
			}
		}
		// After an extinction the world stays empty for a moment. Then one creature is born that
		// fits the climate of that moment. The food stays as it lies, nothing else starts over.
		if (this.creatures.length) this.empty = 0;
		else if (++this.empty > EXTINCT_STEPS) {
			this.creatures.push({ x: this.random() * WIDTH, y: this.random() * HEIGHT, dir: 0, energy: 1, ...PIONEER, warmth: env.climate });
			births.push(env.climate);
		}
		return { births, deaths };
	}

	mean(gene) {
		return this.creatures.reduce((sum, c) => sum + c[gene], 0) / (this.creatures.length || 1);
	}
}
