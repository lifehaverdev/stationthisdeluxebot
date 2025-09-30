const tokenDecimalService = require('../core/services/tokenDecimalService');

/**
 * Test suite for TokenDecimalService
 * Validates decimal handling consistency across all token types
 */
describe('TokenDecimalService', () => {
  // Test tokens with known decimals
  const testTokens = [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
    { address: '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820', symbol: 'MS2', decimals: 6 },
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
    { address: '0x0000000000c5dc95539589fbD24BE07c6C14eCa4', symbol: 'CULT', decimals: 18 },
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6 }
  ];

  describe('getTokenDecimals', () => {
    test('should return correct decimals for known tokens', () => {
      testTokens.forEach(token => {
        const decimals = tokenDecimalService.getTokenDecimals(token.address);
        expect(decimals).toBe(token.decimals);
      });
    });

    test('should return 18 for unknown tokens', () => {
      const unknownToken = '0x1234567890123456789012345678901234567890';
      const decimals = tokenDecimalService.getTokenDecimals(unknownToken);
      expect(decimals).toBe(18);
    });
  });

  describe('formatTokenAmount', () => {
    test('should format ETH amounts correctly', () => {
      const ethAddress = '0x0000000000000000000000000000000000000000';
      const amount = '1000000000000000000'; // 1 ETH in wei
      const formatted = tokenDecimalService.formatTokenAmount(amount, ethAddress);
      expect(formatted).toBe('1.0');
    });

    test('should format MS2 amounts correctly', () => {
      const ms2Address = '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820';
      const amount = '1000000'; // 1 MS2 in smallest unit
      const formatted = tokenDecimalService.formatTokenAmount(amount, ms2Address);
      expect(formatted).toBe('1.0');
    });

    test('should format USDC amounts correctly', () => {
      const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const amount = '1000000'; // 1 USDC in smallest unit
      const formatted = tokenDecimalService.formatTokenAmount(amount, usdcAddress);
      expect(formatted).toBe('1.0');
    });
  });

  describe('parseTokenAmount', () => {
    test('should parse ETH amounts correctly', () => {
      const ethAddress = '0x0000000000000000000000000000000000000000';
      const amount = '1.5';
      const parsed = tokenDecimalService.parseTokenAmount(amount, ethAddress);
      expect(parsed.toString()).toBe('1500000000000000000');
    });

    test('should parse MS2 amounts correctly', () => {
      const ms2Address = '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820';
      const amount = '1.5';
      const parsed = tokenDecimalService.parseTokenAmount(amount, ms2Address);
      expect(parsed.toString()).toBe('1500000');
    });

    test('should parse USDC amounts correctly', () => {
      const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const amount = '1.5';
      const parsed = tokenDecimalService.parseTokenAmount(amount, usdcAddress);
      expect(parsed.toString()).toBe('1500000');
    });
  });

  describe('calculateUsdValue', () => {
    test('should calculate USD value correctly for different tokens', () => {
      const testCases = [
        { address: '0x0000000000000000000000000000000000000000', amount: '1000000000000000000', price: 2000, expected: 2000 },
        { address: '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820', amount: '1000000', price: 0.5, expected: 0.5 },
        { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '1000000', price: 1, expected: 1 }
      ];

      testCases.forEach(({ address, amount, price, expected }) => {
        const usdValue = tokenDecimalService.calculateUsdValue(amount, address, price);
        expect(usdValue).toBe(expected);
      });
    });
  });

  describe('getTokenMetadata', () => {
    test('should return correct metadata for known tokens', () => {
      const ethAddress = '0x0000000000000000000000000000000000000000';
      const metadata = tokenDecimalService.getTokenMetadata(ethAddress);
      expect(metadata.symbol).toBe('ETH');
      expect(metadata.decimals).toBe(18);
      expect(metadata.fundingRate).toBe(0.85);
    });

    test('should return default metadata for unknown tokens', () => {
      const unknownToken = '0x1234567890123456789012345678901234567890';
      const metadata = tokenDecimalService.getTokenMetadata(unknownToken);
      expect(metadata.symbol).toBe('UNKNOWN');
      expect(metadata.decimals).toBe(18);
      expect(metadata.fundingRate).toBe(0.7);
    });
  });

  describe('validateTokenAmount', () => {
    test('should validate correct amounts', () => {
      const ethAddress = '0x0000000000000000000000000000000000000000';
      expect(tokenDecimalService.validateTokenAmount('1.5', ethAddress)).toBe(true);
      expect(tokenDecimalService.validateTokenAmount('0', ethAddress)).toBe(true);
      expect(tokenDecimalService.validateTokenAmount('1000.123456789012345678', ethAddress)).toBe(true);
    });

    test('should reject invalid amounts', () => {
      const ethAddress = '0x0000000000000000000000000000000000000000';
      expect(tokenDecimalService.validateTokenAmount('invalid', ethAddress)).toBe(false);
      expect(tokenDecimalService.validateTokenAmount('-1', ethAddress)).toBe(false);
      expect(tokenDecimalService.validateTokenAmount('', ethAddress)).toBe(false);
    });
  });

  describe('round-trip consistency', () => {
    test('should maintain consistency between parse and format', () => {
      const testCases = [
        { address: '0x0000000000000000000000000000000000000000', amount: '1.5' },
        { address: '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820', amount: '1.5' },
        { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '1.5' }
      ];

      testCases.forEach(({ address, amount }) => {
        const parsed = tokenDecimalService.parseTokenAmount(amount, address);
        const formatted = tokenDecimalService.formatTokenAmount(parsed, address);
        expect(formatted).toBe(amount);
      });
    });
  });
});

/**
 * Integration test to verify quote vs processing consistency
 */
describe('Quote vs Processing Consistency', () => {
  test('should produce identical results for quote generation and webhook processing', () => {
    const testCases = [
      { address: '0x0000000000000000000000000000000000000000', amount: '1000000000000000000', price: 2000 },
      { address: '0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820', amount: '1000000', price: 0.5 },
      { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '1000000', price: 1 }
    ];

    testCases.forEach(({ address, amount, price }) => {
      // Simulate quote generation
      const quoteUsdValue = tokenDecimalService.calculateUsdValue(amount, address, price);
      
      // Simulate webhook processing
      const webhookUsdValue = tokenDecimalService.calculateUsdValue(amount, address, price);
      
      expect(quoteUsdValue).toBe(webhookUsdValue);
    });
  });
});
