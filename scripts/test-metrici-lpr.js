const FormData = require('form-data');

async function testMetriciLPR() {
  const API_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const endpointName = process.env.LPR_ENDPOINT || 'metrici-lpr-test';
  const endpoint = `${API_URL}/api/${endpointName}`;
  const authSecret = process.env.LPR_AUTH_SECRET;
  
  console.log('🧪 Testing Metrici LPR API...');
  console.log('📡 Endpoint:', endpoint);
  if (authSecret) {
    console.log('🔐 Using authentication with LPR_AUTH_SECRET');
  }
  
  // Create form data
  const form = new FormData();
  
  // Add text fields (simulating Metrici LPR data)
  form.append('id', '1'); // Camera ID (1=entrance, 2=exit)
  form.append('number', 'B123ABC'); // License plate
  form.append('country_code', 'RO'); // Country code
  form.append('first_seen', '2024-01-15_10:30:15'); // First detection
  form.append('last_seen', '2024-01-15_10:30:18'); // Last detection
  form.append('probability', '0.95'); // Recognition confidence
  form.append('direction', '1'); // 1=coming, 2=leaving, 3=unknown
  form.append('transactionkey', 'test_transaction_12345'); // Unique key
  form.append('vehicle_class', 'Car'); // Vehicle type
  form.append('vehicle_color', 'Blue'); // Vehicle color
  form.append('vehicle_maker', 'BMW'); // Vehicle manufacturer
  form.append('gps_latitude', '44.472991'); // GPS coordinates (if available)
  form.append('gps_longitude', '26.137505');
  form.append('weight', '1500.5'); // Weight (if scale connected)
  form.append('speed', '25.3'); // Speed (if radar connected)
  form.append('have_companion', '0'); // Companion camera flag
  form.append('auth', 'test_auth_hash_md5'); // Authentication hash
  
  // Add simple fake images (just minimal data)
  form.append('plate_image', Buffer.from('/9j/4AAQSkZJRgABAQEA', 'base64'), {
    filename: 'plate.jpg',
    contentType: 'image/jpeg'
  });
  
  form.append('car_image', Buffer.from('/9j/4AAQSkZJRgABAQEA', 'base64'), {
    filename: 'car.jpg', 
    contentType: 'image/jpeg'
  });
  
  console.log('📷 Added test images to form data');
  
  try {
    // Send the request
    console.log('📤 Sending test request...');
    
    const fetch = (await import('node-fetch')).default;
    
    // Prepare headers
    const headers = form.getHeaders();
    if (authSecret) {
      headers['Authorization'] = `Bearer ${authSecret}`;
    }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      headers: headers
    });
    
    const responseText = await response.text();
    
    console.log('📥 Response received:');
    console.log('📊 Status:', response.status);
    console.log('📋 Headers:', Object.fromEntries(response.headers.entries()));
    console.log('📄 Body:', responseText);
    
    // Validate response according to Metrici documentation
    if (responseText.includes('fbd782b5b1f90875a9773ef20bcc16aa')) {
      console.log('✅ Valid check action response received');
      if (responseText.includes('open_barrier')) {
        console.log('🚪 Barrier open command included');
      }
    } else if (responseText.includes('bb1e8f805814a0b8e46560134687237')) {
      console.log('✅ Valid reporting event response received');
    } else if (responseText === 'LPR disabled') {
      console.log('🚫 LPR is disabled via environment variable');
    } else if (responseText === 'Unauthorized') {
      console.log('🔒 Authentication failed - check LPR_AUTH_SECRET');
    } else {
      console.log('⚠️ Unexpected response format');
    }
    
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Make sure your Next.js server is running on port 3000');
    }
  }
}

// Run test scenarios
async function runTests() {
  console.log('🚀 Starting Metrici LPR API Tests\n');
  
  // Show environment variable status
  console.log('📋 Environment Variables Status:');
  console.log(`   LPR_ENABLED: ${process.env.LPR_ENABLED || 'not set (default: enabled)'}`);
  console.log(`   LPR_DEBUG_MODE: ${process.env.LPR_DEBUG_MODE || 'not set (default: false)'}`);
  console.log(`   LPR_AUTH_SECRET: ${process.env.LPR_AUTH_SECRET ? 'set' : 'not set'}`);
  console.log(`   LPR_AUTO_OPEN_BARRIER: ${process.env.LPR_AUTO_OPEN_BARRIER || 'not set (default: true)'}`);
  console.log(`   LPR_DEFAULT_ACTION: ${process.env.LPR_DEFAULT_ACTION || 'not set (default: allow)'}`);
  console.log('');
  
  // Test 1: Entrance event
  console.log('=== TEST 1: Vehicle Entrance ===');
  await testMetriciLPR();
  
  console.log('\n🏁 Test completed!');
  console.log('📊 Check your console logs on Vercel/server for detailed output');
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testMetriciLPR, runTests }; 