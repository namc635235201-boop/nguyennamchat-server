$reqs = Invoke-RestMethod -Uri http://localhost:4040/api/requests/http
if ($reqs.requests.Count -eq 0) {
    Write-Host "No requests at all in Ngrok history."
} else {
    Write-Host "All requests in Ngrok history:"
    $reqs.requests | Select-Object -Property start, 
        @{n='method';e={$_.request.method}}, 
        @{n='uri';e={$_.request.uri}}, 
        @{n='status';e={$_.response.status_code}} | Format-Table
}
