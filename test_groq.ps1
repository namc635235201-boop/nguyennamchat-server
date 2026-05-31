$body = @{
    model = "llama-3.3-70b-versatile"
    messages = @(
        @{ role = "system"; content = "Ban la tro ly tu van." }
        @{ role = "user"; content = "alo" }
    )
    max_tokens = 100
    temperature = 0.7
} | ConvertTo-Json -Depth 5

try {
    $GROQ_API_KEY = $env:GROQ_API_KEY  # Đặt key vào biến môi trường, không hardcode
$response = Invoke-WebRequest -Uri 'https://api.groq.com/openai/v1/chat/completions' -Method POST -Body $body -ContentType 'application/json' -Headers @{ "Authorization" = "Bearer $GROQ_API_KEY" } -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Response: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response Body: $($reader.ReadToEnd())"
    }
}
