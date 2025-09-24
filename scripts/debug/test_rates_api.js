#!/usr/bin/env node

/**
 * Test script for the updated rates API with real-time pricing
 * 
 * This script tests both the internal and external rates APIs to ensure
 * they properly fetch real-time MS2 and CULT prices from PriceFeedService.
 */

const axios = require('axios');

const INTERNAL_API_BASE_URL = process.env.INTERNAL_API_BASE_URL || 'http://localhost:4000';
const EXTERNAL_API_BASE_URL = process.env.EXTERNAL_API_BASE_URL || 'http://localhost:4000';

async function testInternalRatesApi() {
  console.log('\n🔍 Testing Internal Rates API...');
  console.log('=' .repeat(50));
  
  try {
    const response = await axios.get(`${INTERNAL_API_BASE_URL}/api/internal/v1/data/economy/rates`);
    
    console.log('✅ Internal API Response:');
    console.log(`   Status: ${response.status}`);
    console.log(`   Success: ${response.data.success}`);
    console.log(`   Timestamp: ${response.data.timestamp}`);
    console.log(`   Request ID: ${response.data.requestId}`);
    
    if (response.data.data) {
      console.log('\n📊 Exchange Rates:');
      console.log(`   POINTS_per_USD: ${response.data.data.POINTS_per_USD}`);
      console.log(`   MS2_per_USD: ${response.data.data.MS2_per_USD}`);
      console.log(`   CULT_per_USD: ${response.data.data.CULT_per_USD}`);
      
      // Check if we got real-time data (not fallback values)
      const isRealTimeData = response.data.data.MS2_per_USD !== 2 || response.data.data.CULT_per_USD !== 50;
      console.log(`\n🎯 Data Source: ${isRealTimeData ? 'Real-time pricing' : 'Fallback rates'}`);
    }
    
  } catch (error) {
    console.error('❌ Internal API Error:', error.message);
    if (error.response) {
      console.error('   Response Status:', error.response.status);
      console.error('   Response Data:', error.response.data);
    }
  }
}

async function testExternalRatesApi() {
  console.log('\n🔍 Testing External Rates API...');
  console.log('=' .repeat(50));
  
  try {
    const response = await axios.get(`${EXTERNAL_API_BASE_URL}/api/external/economy/rates`);
    
    console.log('✅ External API Response:');
    console.log(`   Status: ${response.status}`);
    console.log(`   Success: ${response.data.success}`);
    console.log(`   Timestamp: ${response.data.timestamp}`);
    console.log(`   Request ID: ${response.data.requestId}`);
    console.log(`   Source: ${response.data.source}`);
    
    if (response.data.data) {
      console.log('\n📊 Exchange Rates:');
      console.log(`   POINTS_per_USD: ${response.data.data.POINTS_per_USD}`);
      console.log(`   MS2_per_USD: ${response.data.data.MS2_per_USD}`);
      console.log(`   CULT_per_USD: ${response.data.data.CULT_per_USD}`);
      
      // Check if we got real-time data
      const isRealTimeData = response.data.data.MS2_per_USD !== 2 || response.data.data.CULT_per_USD !== 50;
      console.log(`\n🎯 Data Source: ${isRealTimeData ? 'Real-time pricing' : 'Fallback rates'}`);
    }
    
  } catch (error) {
    console.error('❌ External API Error:', error.message);
    if (error.response) {
      console.error('   Response Status:', error.response.status);
      console.error('   Response Data:', error.response.data);
    }
  }
}

async function testHealthEndpoints() {
  console.log('\n🔍 Testing Health Endpoints...');
  console.log('=' .repeat(50));
  
  try {
    const [internalHealth, externalHealth] = await Promise.allSettled([
      axios.get(`${INTERNAL_API_BASE_URL}/api/internal/v1/data/economy/rates/health`),
      axios.get(`${EXTERNAL_API_BASE_URL}/api/external/economy/rates/health`)
    ]);
    
    if (internalHealth.status === 'fulfilled') {
      console.log('✅ Internal API Health:', internalHealth.value.data);
    } else {
      console.log('❌ Internal API Health Error:', internalHealth.reason.message);
    }
    
    if (externalHealth.status === 'fulfilled') {
      console.log('✅ External API Health:', externalHealth.value.data);
    } else {
      console.log('❌ External API Health Error:', externalHealth.reason.message);
    }
    
  } catch (error) {
    console.error('❌ Health Check Error:', error.message);
  }
}

async function main() {
  console.log('🚀 Testing Updated Rates API with Real-Time Pricing');
  console.log('=' .repeat(60));
  console.log(`Internal API URL: ${INTERNAL_API_BASE_URL}`);
  console.log(`External API URL: ${EXTERNAL_API_BASE_URL}`);
  
  await testInternalRatesApi();
  await testExternalRatesApi();
  await testHealthEndpoints();
  
  console.log('\n✨ Test completed!');
  console.log('\n💡 Expected Results:');
  console.log('   - If PriceFeedService is working: Real-time MS2/CULT prices');
  console.log('   - If PriceFeedService fails: Fallback rates (MS2=2, CULT=50)');
  console.log('   - Both APIs should return the same data');
  console.log('   - External API should show source as "internal-api" or "fallback"');
  console.log('\n🔧 Frontend Testing:');
  console.log('   - Open browser console in sandbox');
  console.log('   - Run: window.refreshExchangeRates()');
  console.log('   - Check: window.costHUD.exchangeRates');
  console.log('   - Expected: MS2_per_USD should be ~7,462 (1/0.000134)');
  console.log('   - Expected: CULT_per_USD should be ~1,429 (1/0.0007)');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testInternalRatesApi,
  testExternalRatesApi,
  testHealthEndpoints
};
