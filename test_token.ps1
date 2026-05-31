$token = "EAAKyxhV8rKgBRshFZBFYheie6rZC8ahm21EYAUX2CIX96RG99tYQEjZCKVYnI4DRTT23PTg4GnZBDfYwMZCxRymCJbTyQ4GZBrZAXf5DErkBuIS0UBgRY6w1HRBZB9uMcBF3g1AbhrG03YkZAzPPJG56MXUXflJfhCFKH4krZBUeXjn4yZBhZBsxuM7MR8ZAm5EwET9NTjlsAo2Ig81LgQWYvzv8ZCceCNO7WI5FTbZAolhDKIZD"

# Test if page token is valid by getting page info
try {
    $response = Invoke-WebRequest -Uri "https://graph.facebook.com/v19.0/me?access_token=$token" -UseBasicParsing
    Write-Host "Page Token OK: $($response.Content)"
} catch {
    Write-Host "Page Token ERROR: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Details: $($reader.ReadToEnd())"
    }
}
