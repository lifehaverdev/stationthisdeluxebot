/**
 * @typedef {object} TeamInvitation
 * @property {string} inviteCode - Unique code for the invitation.
 * @property {string} [email] - Email address the invitation was sent to (optional).
 * @property {'pending'|'accepted'|'declined'|'expired'} status - Status of the invitation.
 * @property {Date} createdAt - When the invitation was created.
 * @property {Date} [expiresAt] - When the invitation expires (optional).
 * @property {string} [invitedByMasterAccountId] - masterAccountId of the user who sent the invitation.
 */

/**
 * @typedef {object} TeamLineOfCredit
 * @property {number} limitUsd - The maximum amount of credit available in USD.
 * @property {number} currentDebtUsd - The current outstanding debt in USD.
 * @property {boolean} enabled - Whether the line of credit is active.
 * @property {Date} [approvedAt] - When the line of credit was approved.
 * @property {string} [approvedBy] - Who approved the line of credit.
 */

/**
 * @typedef {object} TeamUsageLimits
 * @property {number} [monthlySpendUsd] - Optional monthly spending limit for the team.
 * @property {number} [maxMembers] - Optional maximum number of members in the team.
 */

/**
 * @typedef {object} Team
 * @property {import('mongodb').ObjectId} _id - Unique identifier for the team.
 * @property {string} teamName - User-defined name for the team.
 * @property {import('mongodb').ObjectId} ownerMasterAccountId - The masterAccountId of the user who owns the team.
 * @property {Array<import('mongodb').ObjectId>} [adminMasterAccountIds] - Array of masterAccountIds for team administrators.
 * @property {Array<import('mongodb').ObjectId>} [memberMasterAccountIds] - Array of masterAccountIds for team members (excluding owner and admins if they are listed separately).
 * @property {number} [usdCredit] - Current available credit/balance for the team in USD (pre-paid). Defaults to 0.
 * @property {TeamLineOfCredit} [lineOfCredit] - Details for the team's line of credit.
 * @property {TeamUsageLimits} [usageLimits] - Usage limits for the team.
 * @property {Object<string, any>} [userDefaultSettingsOverrides] - Default settings that team members inherit, can be overridden at teamMembership level.
 * @property {Array<TeamInvitation>} [invitations] - Array of pending or past invitations to join the team.
 * @property {Date} createdAt - Timestamp of when the team was created.
 * @property {Date} updatedAt - Timestamp of when the team was last updated.
 * @property {Object<string, any>} [metadata] - For any additional non-standard data.
 */

// This file is for JSDoc type definitions.
// It doesn't export any runtime code.
// module.exports = {}; // Not strictly necessary if only defining types for JSDoc 