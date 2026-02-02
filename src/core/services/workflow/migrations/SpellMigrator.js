/**
 * SpellMigrator - Automatically migrates spell steps to current tool versions
 *
 * When tool schemas change (parameter renames, restructuring), this service
 * automatically updates spell step configurations to match the new schema,
 * preventing spells from breaking when tools are updated.
 */
class SpellMigrator {
  /**
   * @param {Object} options
   * @param {Object} options.toolRegistry - ToolRegistry instance for looking up tools
   * @param {Object} options.logger - Logger instance
   */
  constructor({ toolRegistry, logger }) {
    this.toolRegistry = toolRegistry;
    this.logger = logger || console;
  }

  /**
   * Check and migrate a spell's steps to current tool versions
   * @param {Object} spell - Spell document
   * @returns {{ spell: Object, migrated: boolean, changes: Array }}
   */
  migrate(spell) {
    const changes = [];
    let migrated = false;

    if (!spell || !Array.isArray(spell.steps)) {
      return { spell, migrated: false, changes: [] };
    }

    spell.steps.forEach((step, index) => {
      const toolIdentifier = step.toolIdentifier || step.toolId;
      if (!toolIdentifier) return;

      const tool = this.toolRegistry.getToolById(toolIdentifier);
      if (!tool) {
        this.logger.warn(`[SpellMigrator] Tool "${toolIdentifier}" not found in registry, skipping migration for step ${index}`);
        return;
      }

      const stepVersion = step.toolVersion || '1.0.0';
      const currentVersion = tool.version || '1.0.0';

      if (this._needsMigration(stepVersion, currentVersion)) {
        const stepChanges = this._migrateStep(step, tool, stepVersion, currentVersion);
        if (stepChanges.length > 0) {
          changes.push({
            stepIndex: index,
            toolId: toolIdentifier,
            fromVersion: stepVersion,
            toVersion: currentVersion,
            changes: stepChanges
          });
          step.toolVersion = currentVersion;
          migrated = true;
        }
      }
    });

    return { spell, migrated, changes };
  }

  /**
   * Migrate a single step from one version to another
   * @private
   */
  _migrateStep(step, tool, fromVersion, toVersion) {
    const changes = [];
    const migrations = tool.migrations || {};

    // Get all versions that need migration (sorted)
    const versions = Object.keys(migrations)
      .filter(v => this._compareVersions(v, fromVersion) > 0 &&
                   this._compareVersions(v, toVersion) <= 0)
      .sort((a, b) => this._compareVersions(a, b));

    for (const version of versions) {
      const migration = migrations[version];
      if (migration.parameters) {
        changes.push(...this._migrateParameters(step, migration.parameters));
      }
    }

    return changes;
  }

  /**
   * Migrate parameter mappings based on migration definition
   * @private
   */
  _migrateParameters(step, parameterMigrations) {
    const changes = [];
    const mappings = step.parameterMappings || {};

    for (const [oldKey, newKeyDef] of Object.entries(parameterMigrations)) {
      // Check if the old parameter exists in the mappings
      if (mappings[oldKey] !== undefined && mappings[oldKey] !== null) {
        // Handle context-dependent mappings
        let targetKey;
        if (typeof newKeyDef === 'object' && newKeyDef !== null) {
          // Context-dependent mapping: check condition
          const condition = newKeyDef.when;
          if (condition && mappings[condition.field]) {
            // Get the actual value from the mapping
            const fieldValue = this._getMappingValue(mappings[condition.field]);
            targetKey = fieldValue === condition.value ? condition.use : newKeyDef.default;
          } else {
            targetKey = newKeyDef.default;
          }
        } else {
          // Simple string mapping
          targetKey = newKeyDef;
        }

        // Only migrate if target key doesn't already exist
        if (mappings[targetKey] === undefined || mappings[targetKey] === null) {
          mappings[targetKey] = mappings[oldKey];
          delete mappings[oldKey];
          changes.push({ type: 'parameter_rename', from: oldKey, to: targetKey });
        }
      }
    }

    return changes;
  }

  /**
   * Extract the actual value from a parameter mapping
   * Mappings can be simple values or objects with { type, value } structure
   * @private
   */
  _getMappingValue(mapping) {
    if (mapping && typeof mapping === 'object') {
      // Handle { type: 'static', value: 'some-value' } structure
      if (mapping.type === 'static' || mapping.type === 'literal') {
        return mapping.value;
      }
      // Handle direct value property
      if (mapping.value !== undefined) {
        return mapping.value;
      }
    }
    return mapping;
  }

  /**
   * Compare two semver strings
   * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
   * @private
   */
  _compareVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  /**
   * Check if migration is needed
   * @private
   */
  _needsMigration(fromVersion, toVersion) {
    return this._compareVersions(fromVersion, toVersion) < 0;
  }
}

module.exports = SpellMigrator;
