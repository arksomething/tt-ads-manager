"""Render an immutable earnings snapshot; never reads current deals or payment credentials."""
import json,sys,io,hashlib
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT

def render(record):
 raw=record['payload_json']
 if hashlib.sha256(raw.encode()).hexdigest()!=record['sha256']:raise ValueError('Audit hash mismatch')
 data=json.loads(raw);summary=data['summary'];checks=data.get('audit_checks',{});inputs=data.get('audit_inputs',{})
 output=io.BytesIO();styles=getSampleStyleSheet()
 styles.add(ParagraphStyle(name='SmallText',fontName='Helvetica',fontSize=8,leading=11,spaceAfter=5))
 styles.add(ParagraphStyle(name='CellText',fontName='Helvetica',fontSize=7,leading=9))
 styles['BodyText'].fontSize=10;styles['BodyText'].leading=15
 story=[]
 def p(text,style='BodyText'):return Paragraph(escape(str(text)).replace('\n','<br/>'),styles[style])
 def add(text,style='BodyText'):story.extend([p(text,style),Spacer(1,8)])
 def table(rows,widths,header=True):
  t=Table([[p(v,'CellText') for v in row] for row in rows],colWidths=widths,repeatRows=1 if header else 0,hAlign='LEFT')
  t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e7eef4')),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor('#8aa3b5')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f6f8fa')]),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]));story.append(t);story.append(Spacer(1,12))
 money=lambda value:f'{float(value or 0):,.2f}'
 creators=data.get('creators',[]);currency=creators[0].get('currency','USD') if creators else 'USD'
 add('GoTall | Earnings calculation audit','Title')
 add('ESTIMATE - NOT A FINAL PAYMENT STATEMENT','Heading2')
 add(f"Period: {data.get('month')} | Calculated: {data.get('calculated_at')}")
 add('Account: '+', '.join(str(c.get('tiktokHandle') or c.get('creatorName') or c.get('creatorId')) for c in creators))
 add(f"Calculated earnings: {money(summary['totalPay'])} {currency}",'Heading1')
 table([['Component','Amount'],['Fixed period pay',money(summary.get('fixedPay'))],['Per-video fees',money(summary.get('videoFixedPay'))],['View-based earnings',money(summary.get('cpmPay'))],['Total calculated earnings',money(summary['totalPay'])]],[365,158])
 add(f"{summary.get('videos',0)} videos | {summary.get('payableViews',0):,} counted views | {summary.get('paidViewsDeducted',0):,} paid views deducted")
 add('Accuracy and unresolved checks','Heading2')
 add('Line totals reconcile with the calculator total.' if checks.get('totals_reconcile') else 'One or more arithmetic reconciliation checks need attention.')
 add(f"Unknown paid-traffic status: {checks.get('unknown_paid_videos',0)} videos. Unknown does not mean zero paid traffic.")
 warnings=data.get('warnings',[])
 for warning in warnings[:3]:add(warning,'SmallText')
 if len(warnings)>3:add(f'{len(warnings)} source warnings were captured. The companion JSON retains the full list, including every affected date window.','SmallText')
 differences=checks.get('decimal_rounding_differences',[])
 add(f"Independent decimal repricing: {len(differences)} differences. Creator-cap rows requiring aggregate verification: {checks.get('creator_cap_rows_not_independently_repriced',0)}.")
 add('This report preserves the calculator inputs and results. It does not independently prove that every post was retrieved, that platform view counts are correct, or that paid-traffic deductions are complete.','SmallText')
 story.append(PageBreak())
 add('Calculation rules and provenance','Title')
 add(f"Audit ID: {data['audit_id']}",'SmallText')
 add(f"Snapshot SHA-256: {record['sha256']}",'SmallText')
 add(f"Source: {inputs.get('provider','Not captured')}")
 add(f"Reporting timezone: {inputs.get('report_timezone','UTC')}\nView attribution: {inputs.get('view_window','Not captured')}\nRange: {data.get('from',data.get('start_date','See companion JSON'))} to {data.get('to',data.get('end_date','See companion JSON'))}",'SmallText')
 add('Published terms captured for this calculation','Heading2')
 for term in inputs.get('terms',[]):
  # Preserve every term field in the companion JSON; display the monetary rules and version identity here.
  wanted=[(k,v) for k,v in term.items() if any(s in k.lower() for s in ['id','start','end','effective','fee','cpm','cap','window','paid','currency'])]
  table([['Term','Value']]+[[k,json.dumps(v,ensure_ascii=True) if isinstance(v,(dict,list)) else str(v)] for k,v in wanted],[180,343])
 overrides=inputs.get('video_overrides',[])
 add(f"Per-video overrides captured: {len(overrides)}. Full terms, overrides and normalized video inputs are included in the companion JSON.",'SmallText')
 add('Engine fingerprints','Heading2')
 for name,digest in inputs.get('engine_sha256',{}).items():add(f'{name}\n{digest}','SmallText')
 add('Arithmetic checks','Heading2')
 table([['Check','Result','Actual / expected']]+[[v['check'],'PASS' if v['passed'] else 'CHECK',f"{v['actual']} / {v['expected']}"] for v in checks.get('checks',[])],[290,55,178])
 if differences:table([['Video','Calculator','Decimal check']]+[[v['video'],v['reported'],v['decimal_check']] for v in differences],[300,110,113])
 story.append(PageBreak());add('Per-video calculation ledger','Title')
 add('Amounts are in '+currency+'. Counted views follow the configured reporting period and deal window. Paid status is reproduced from the source. Full URLs and all rule inputs are in the companion JSON.','SmallText')
 rows=[['Video ID / date','Counted views','Paid status','Video fee','CPM','View pay','Total']]
 for c in creators:
  for v in c.get('videos',[]):
   rows.append([str(v.get('sourceVideoId') or v.get('videoId'))+'\n'+str(v.get('publishedAt') or '')[:10],f"{v.get('payableViews',0):,}",v.get('paidStatus','unknown'),money(v.get('fixedFeePerVideo')),money(v.get('cpmAmount')),money(v.get('cpmPay')),money(v.get('videoPay'))])
 table(rows,[120,60,65,50,40,60,128])
 add('Audit retention: each successful refresh creates a separate immutable database record. This download reproduces that record; it does not recalculate using newer terms.','SmallText')
 def footer(canvas,doc):
  canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#526579'));canvas.drawString(36,22,'GoTall | '+data['audit_id'][:8]+' | Earnings estimate');canvas.drawRightString(559,22,f'Page {doc.page}')
 SimpleDocTemplate(output,pagesize=(595,842),rightMargin=36,leftMargin=36,topMargin=36,bottomMargin=40,title='GoTall earnings calculation audit',author='GoTall',pageCompression=1).build(story,onFirstPage=footer,onLaterPages=footer)
 return output.getvalue()
if __name__=='__main__':sys.stdout.buffer.write(render(json.load(sys.stdin)))

