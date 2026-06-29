const { notarize } = require('@electron/notarize')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`
  console.log('Notarizing', appPath)
  await notarize({
    tool: 'notarytool',
    appPath,
    keychainProfile: 'scene-search-notary'
  })
}
