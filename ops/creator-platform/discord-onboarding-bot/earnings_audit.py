"""Independent arithmetic checks on the exact stored calculator output."""
from decimal import Decimal,ROUND_HALF_UP
def dec(v):return Decimal(str(v or 0))
def cents(v):return dec(v).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
def reconcile(data):
 rows=[v for c in data.get('creators',[]) for v in c.get('videos',[])]
 s=data['summary'];checks=[]
 for label,actual,expected in [
  ('Video amounts plus fixed fees equal payout',sum((dec(r['videoPay']) for r in rows),Decimal(0))+dec(s['fixedPay']),dec(s['totalPay'])),
  ('View-earnings lines reconcile',sum((dec(r['cpmPay']) for r in rows),Decimal(0)),dec(s['cpmPay'])),
  ('Per-video fee lines reconcile',sum((dec(r['fixedFeePerVideo']) for r in rows),Decimal(0)),dec(s['videoFixedPay'])),
  ('Video count reconciles',Decimal(len(rows)),dec(s['videos'])),
  ('Counted views reconcile',sum((dec(r['payableViews']) for r in rows),Decimal(0)),dec(s['payableViews']))]:
  checks.append({'check':label,'passed':actual==expected,'actual':str(actual),'expected':str(expected)})
 differences=[];creator_caps=0
 for row in rows:
  if row.get('creatorTotalCapApplied'):creator_caps+=1;continue
  fee=dec(row['fixedFeePerVideo']);view=dec(row['payableViews'])/1000*dec(row['cpmAmount']);total=fee+view
  scope=row['perVideoCapScope'];cap=dec(row['payoutCapPerVideo'])
  if scope=='CPM':view=min(view,cap);total=fee+view
  elif scope=='TOTAL':total=min(total,cap);view=max(total-fee,Decimal(0))
  if cents(total)!=dec(row['videoPay']) or cents(view)!=dec(row['cpmPay']):
   differences.append({'video':row.get('sourceVideoId') or row['videoId'],'reported':str(row['videoPay']),'decimal_check':str(cents(total))})
 return {'checks':checks,'totals_reconcile':all(c['passed'] for c in checks),'decimal_rounding_differences':differences,'creator_cap_rows_not_independently_repriced':creator_caps,'unknown_paid_videos':s.get('unknownPaidVideos',0),'source_warnings':data.get('warnings',[])}
