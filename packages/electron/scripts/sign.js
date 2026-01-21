const { execSync } = require('child_process');
const path = require('path');

/**
 * Ad-hoc code signing for macOS
 * This applies a local signature to the app so it can run on macOS without a developer certificate
 */
exports.default = async function(context) {
  // Only sign on macOS
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = context.appOutDir + `/${context.packager.appInfo.productFilename}.app`;
  
  console.log('📝 Applying ad-hoc code signature...');
  console.log(`   App path: ${appPath}`);
  
  try {
    // Apply ad-hoc signature with deep signing for all embedded frameworks
    execSync(`codesign --force --deep --sign - "${appPath}"`, {
      stdio: 'inherit'
    });
    console.log('✅ Ad-hoc code signature applied successfully');
  } catch (error) {
    console.error('❌ Failed to apply ad-hoc signature:', error.message);
    // Don't fail the build, just warn
    console.warn('⚠️  App may not run properly on macOS without proper signing');
  }
};

