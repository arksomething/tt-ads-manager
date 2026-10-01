"""Owner-run read-only Superwall metadata audit; no revenue amounts or user rows."""
import json
import httpx
import services


def query(sql):
    credentials = services.credentials()
    with httpx.Client(timeout=90, headers={
        'Authorization': 'Bearer '+credentials['SUPERWALL_API_KEY'],
        'Content-Type': 'text/plain',
    }) as client:
        projects = client.get('https://api.superwall.com/v2/projects')
        projects.raise_for_status()
        matches = [p for p in projects.json()['data'] if p['name']=='GoTall' and not p.get('archived')]
        if len(matches)!=1:raise ValueError('GoTall project is ambiguous')
        project=matches[0]
        apps=[int(a['id']) for a in project['applications'] if not a.get('archived_at')]
        scope='applicationId IN ('+','.join(map(str,apps))+') AND isSandbox=0 AND environment=\'PRODUCTION\''
        response=client.post(f"https://api.superwall.com/v2/organizations/{int(project['organization_id'])}/query",
                             content=sql.replace('{scope}',scope))
        response.raise_for_status()
        return [json.loads(line) for line in response.text.splitlines() if line.strip()]


if __name__=='__main__':
    import sys
    if sys.argv[1:] == ['schema']:
        print(json.dumps(query('DESCRIBE TABLE open_revenue.attributed_events_by_ts_rep FORMAT JSONEachRow')))
    else:
        print(json.dumps(query("""SELECT name, toString(min(purchasedAt)) first_event,
            toString(max(purchasedAt)) last_event, uniqExact(toDate(purchasedAt)) days,
            uniqExact(toStartOfHour(purchasedAt)) hours,
            groupUniqArray(isTrialConversion) trial_conversion_flags
            FROM open_revenue.attributed_events_by_ts_rep WHERE {scope}
            AND purchasedAt >= now()-INTERVAL 90 DAY
            AND purchasedAt <= now()
            GROUP BY name ORDER BY name FORMAT JSONEachRow""")))
