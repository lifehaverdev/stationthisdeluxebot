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