const crypto = require('crypto');

/**
 * TraitEngine – selects random traits & applies them to parameter templates.
 * All methods are pure and synchronous.
 */
class TraitEngine {
  /**
   * Generate deterministic hash from collection config (placeholder)
   */
  static createConfigHash(collection) {
    const json = JSON.stringify(collection);
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  /**
   * Select traits from a traitTypes array ({title, traits:[{name,prompt,rarity?}]})
   * Returns { selectedTraits: {title:prompt}, traitDetails:[{type,value:{name,prompt,rarity}}] }
   */
  static generateTraitSelection(traitTypes = []) {
    const selectedTraits = {};
    const traitDetails = [];

    traitTypes.forEach((traitType) => {
      if (!traitType.traits || traitType.traits.length === 0) return;
      const totalWeight = traitType.traits.reduce((acc, t) => acc + (t.rarity || 0.5), 0);
      let r = Math.random() * totalWeight;
      let winner = traitType.traits[0];
      for (const t of traitType.traits) {
        r -= (t.rarity || 0.5);
        if (r <= 0) { winner = t; break; }
      }
      selectedTraits[traitType.title] = winner.prompt;
      traitDetails.push({ type: traitType.title, value: { name: winner.name, prompt: winner.prompt, rarity: winner.rarity } });
    });

    return { selectedTraits, traitDetails };
  }

  /**
   * New: select from new traitTree schema
   * categories: [{ name, mode:'manual'|'generated', traits?, generator? }]
   * options: { deterministicIndex?:number, shuffleSeed?:number }
   * Returns map of { [CategoryName]: valueString }
   */
  static selectFromTraitTree(categories = [], options = {}) {
    const result = {};
    const detIndex = Number.isFinite(options.deterministicIndex) ? options.deterministicIndex : null;
    categories.forEach((cat) => {
      if (!cat || !cat.name) return;
      if (cat.mode === 'generated' && cat.generator && cat.generator.type === 'range') {
        const start = Number.isFinite(cat.generator.start) ? cat.generator.start : 0;
        const end = Number.isFinite(cat.generator.end) ? cat.generator.end : start;
        const step = Number.isFinite(cat.generator.step) && cat.generator.step > 0 ? cat.generator.step : 1;
        const zeroPad = Number(cat.generator.zeroPad) || 0;
        const count = end >= start ? Math.floor((end - start) / step) + 1 : 0;
        if (count <= 0) return;
        let idx;
        if (detIndex !== null && cat.generator.uniqueAcrossCook) {
          // Deterministic assignment: optional shuffled mapping
          const baseIdx = detIndex % count;
          const seed = Number.isFinite(cat.generator.shuffleSeed) ? cat.generator.shuffleSeed : null;
          idx = seed !== null ? TraitEngine._shuffleIndex(baseIdx, count, seed) : baseIdx;
        } else {
          idx = Math.floor(Math.random() * count);
        }
        const num = start + idx * step;
        const val = zeroPad > 0 ? String(num).padStart(zeroPad, '0') : String(num);
        result[cat.name] = val;
      } else if (Array.isArray(cat.traits) && cat.traits.length) {
        // Manual mode - rarity weighted
        const totalWeight = cat.traits.reduce((acc, t) => acc + (t.rarity || 0.5), 0);
        let r = Math.random() * totalWeight;
        let winner = cat.traits[0];
        for (const t of cat.traits) {
          r -= (t.rarity || 0.5);
          if (r <= 0) { winner = t; break; }
        }
        const value = winner.value !== undefined ? winner.value : (winner.prompt || winner.name || '');
        result[cat.name] = String(value);
      }
    });
    return result;
  }

  static _shuffleIndex(index, count, seed) {
    // Simple LCG-based pseudo-shuffle mapping: f(i) = (i * a + b) mod count
    // Choose a relative prime multiplier a and offset b derived from seed
    const a = TraitEngine._relPrime(count, 9301 + (seed % 1000));
    const b = (49297 + seed) % count;
    return (index * a + b) % count;
  }

  static _relPrime(n, candidate) {
    function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
    let a = Math.abs(candidate) || 1;
    if (a >= n) a = a % n;
    if (a === 0) a = 1;
    while (gcd(a, n) !== 1) { a = (a + 1) % n || 1; }
    return a;
  }

  /**
   * Recursively walk a params object/array and replace [[Trait]] placeholders
   * with the selected prompt value.
   */
  static applyTraitsToParams(paramsTemplate, selectedTraits) {
    const replacer = (value) => {
      if (typeof value === 'string') {
        let result = value;
        Object.entries(selectedTraits).forEach(([trait, prompt]) => {
          const regex = new RegExp(`\\[\\[${trait}\\]\\]`, 'g');
          result = result.replace(regex, prompt);
        });
        return result;
      } else if (Array.isArray(value)) {
        return value.map(replacer);
      } else if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) out[key] = replacer(value[key]);
        return out;
      } else {
        return value;
      }
    };
    return replacer(paramsTemplate);
  }
}

module.exports = TraitEngine; 