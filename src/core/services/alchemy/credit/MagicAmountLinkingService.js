/**
 * MagicAmountLinkingService
 * 
 * Handles magic amount wallet linking detection and completion.
 * Detects deposits with specific "magic amounts" that indicate wallet linking requests.
 */
class MagicAmountLinkingService {
  constructor(walletLinkingRequestDb, walletLinkingService, userCoreDb, logger) {
    this.walletLinkingRequestDb = walletLinkingRequestDb;
    this.walletLinkingService = walletLinkingService;
    this.userCoreDb = userCoreDb;
    this.logger = logger || console;
  }

  /**
   * Checks if a deposit matches a magic amount linking request and handles it.
   * @param {string} depositorAddress - The address that made the deposit
   * @param {string} tokenAddress - The token contract address
   * @param {string} amountWei - The deposit amount in wei (as string)
   * @returns {Promise<boolean>} True if the deposit was handled as a magic amount linking
   */
  async checkMagicAmount(depositorAddress, tokenAddress, amountWei) {
    try {
      const linkingRequest = await this.walletLinkingRequestDb.findPendingRequestByAmount(amountWei, tokenAddress);

      if (linkingRequest) {
        this.logger.info(`[MagicAmountLinkingService] Detected "Magic Amount" deposit for wallet linking. Request ID: ${linkingRequest._id}`);
        
        await this.completeLinking(linkingRequest, depositorAddress);
        return true; // Indicate that the deposit was handled.
      }
      return false; // No matching request found.
    } catch (error) {
      this.logger.error(`[MagicAmountLinkingService] Error during magic amount linking check for address ${depositorAddress}:`, error);
      // We don't re-throw, as this shouldn't block the main credit processing flow.
      return false;
    }
  }

  /**
   * Completes the wallet linking process.
   * @param {object} request - The linking request object
   * @param {string} depositorAddress - The address that made the deposit
   * @returns {Promise<void>}
   */
  async completeLinking(request, depositorAddress) {
    const { _id: requestId, master_account_id: masterAccountId } = request;

    // Add the wallet to the user's core document
    await this.userCoreDb.addWallet(masterAccountId, {
      address: depositorAddress,
      verified: true,
      tag: 'magic-link-deposit',
      linkedAt: new Date(),
    });

    // Mark the linking request as completed in the DB
    await this.walletLinkingRequestDb.updateRequestStatus(requestId, 'COMPLETED', {
      linked_wallet_address: depositorAddress
    });

    // Trigger the service to generate and cache the API key
    await this.walletLinkingService.completeLinkingAndGenerateFirstApiKey(masterAccountId, requestId);

    this.logger.info(`[MagicAmountLinkingService] Successfully linked wallet ${depositorAddress} to master account ${masterAccountId}. Key generation triggered.`);
  }
}

module.exports = MagicAmountLinkingService;

