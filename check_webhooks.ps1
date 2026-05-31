$reqs = Invoke-RestMethod -Uri http://localhost:4040/api/requests/http
$webhooks = $reqs.requests | Where-Object { $_.request.uri -like "*webhook*" }

if ($webhooks.Count -eq 0) {
    Write-Host "No webhook requests received yet in Ngrok history."
} else {
    Write-Host "Webhook requests received in Ngrok history:"
    $webhooks | Select-Object -Property start, 
        @{n='method';e={$_.request.method}}, 
        @{n='uri';e={$_.request.uri}}, 
        @{n='status';e={$_.response.status_code}} | Format-Table
}
