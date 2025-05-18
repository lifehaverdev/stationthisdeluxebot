/**
 * @typedef {object} TeamMemberSettings
 * @property {number} [individualSpendingCapUsd] - Optional individual spending cap for the member within the team.
 * @property {boolean} [canInvite] - Whether this member can invite others to the team (if roles are granular).
 */

/**
 * @typedef {object} TeamMembership
 * @property {import('mongodb').ObjectId} _id - Unique identifier for the membership record.
 * @property {import('mongodb').ObjectId} teamId - Foreign key referencing the `teams` collection.
 * @property {import('mongodb').ObjectId} masterAccountId - Foreign key referencing the `masterAccounts` collection (or user collection).
 * @property {'owner'|'admin'|'member'|'pending'} role - Role of the user within the team.
 * @property {Date} joinedAt - Timestamp of when the user joined the team.
 * @property {TeamMemberSettings} [settings] - Specific settings or overrides for this member within the team.
 * @property {Date} createdAt - Timestamp of when the membership record was created.
 * @property {Date} updatedAt - Timestamp of when the membership record was last updated.
 */

// This file is for JSDoc type definitions.
// It doesn't export any runtime code.
// module.exports = {}; // Not strictly necessary if only defining types for JSDoc 