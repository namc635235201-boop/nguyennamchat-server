$body = '{"object":"page","entry":[{"id":"888451557694404","messaging":[{"sender":{"id":"test_user_123"},"recipient":{"id":"888451557694404"},"message":{"text":"alo test"}}]}]}'

try {
    $response = Invoke-WebRequest -Uri 'http://localhost:3000/webhook' -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Response: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response Body: $($reader.ReadToEnd())"
    }
}
