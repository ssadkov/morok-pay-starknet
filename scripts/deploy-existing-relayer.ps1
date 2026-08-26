$ErrorActionPreference = "Stop"

$secureKey = Read-Host "Paste MOROKPAY_SEPOLIA_RELAYER_PRIVATE_KEY (input is hidden)" -AsSecureString
$expectedAddress = Read-Host "Paste MOROKPAY_SEPOLIA_RELAYER_ADDRESS"
$keyPointer = [IntPtr]::Zero

try {
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $env:MOROKPAY_DEPLOY_PRIVATE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    $env:MOROKPAY_DEPLOY_EXPECTED_ADDRESS = $expectedAddress
    node "$PSScriptRoot\deploy-existing-relayer.mjs"

    if ($LASTEXITCODE -ne 0) {
        throw "Relayer deployment failed with exit code $LASTEXITCODE"
    }
}
finally {
    if ($keyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }

    Remove-Item "Env:MOROKPAY_DEPLOY_PRIVATE_KEY" -ErrorAction SilentlyContinue
    Remove-Item "Env:MOROKPAY_DEPLOY_EXPECTED_ADDRESS" -ErrorAction SilentlyContinue
    $secureKey = $null
}
