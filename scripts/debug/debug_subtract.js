const argsLength = 68; // 0x44
console.log('Args length:', argsLength);
console.log('Args length (hex):', '0x' + argsLength.toString(16));

const base = 0x6100523d8160233d3973n;
console.log('Base (hex):', '0x' + base.toString(16));

// Try subtraction instead of addition
const shift56 = BigInt(argsLength) << 56n;
console.log('Args length << 56:', '0x' + shift56.toString(16));

const result = base - shift56;
console.log('Base - (argsLength << 56):', '0x' + result.toString(16));

// Expected result
const expected = 0x6100443d8160233d3973n;
console.log('Expected:', '0x' + expected.toString(16));
console.log('Match:', result === expected);

// Let's also try different approaches
console.log('\nTrying different approaches:');
console.log('Base + argsLength:', '0x' + (base + BigInt(argsLength)).toString(16));
console.log('Base - argsLength:', '0x' + (base - BigInt(argsLength)).toString(16));

// Let's check what the correct prefix should be by looking at the pattern
// The expected is 0x6100443d8160233d3973
// The base is 0x6100523d8160233d3973
// The difference is 0xe00000000000000
// This suggests that 0x52 - 0x44 = 0xe, which means we need to subtract 0xe from the second byte
console.log('\nPattern analysis:');
console.log('Expected second byte:', '0x' + (expected >> 48n & 0xFFn).toString(16));
console.log('Base second byte:', '0x' + (base >> 48n & 0xFFn).toString(16));
console.log('Difference:', '0x' + ((expected >> 48n & 0xFFn) - (base >> 48n & 0xFFn)).toString(16));
