$body = '{"object":"page","entry":[{"id":"888451557694404","messaging":[{"sender":{"id":"test_debug_user"},"recipient":{"id":"888451557694404"},"message":{"text":"alo"}}]}]}'

try {
    $response = Invoke-WebRequest -Uri 'http://localhost:3000/webhook' -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
