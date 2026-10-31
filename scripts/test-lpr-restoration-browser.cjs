// Run through the actual Next pages/API, using the local-emulator harness.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
module.exports=async({page,db,expect,errors})=>{
 const request=async(url,body,token='admin')=>{const r=await fetch('http://localhost:3182'+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data}
 const wall=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T')+'.000Z'
 const camera=(number,type,at)=>request('/NotificationInfo/TollgateInfo',{Picture:{Plate:{PlateNumber:number},SnapInfo:{DeviceID:type==='entry'?'intrare_1':'iesire_1',AccurateTime:at}}},'browser-fixture-camera')
 const total=async expected=>{assert.equal((await request('/api/admin/occupancy')).occupiedCount,expected);assert.equal((await db.doc('config/parkingLive').get()).data().occupiedCount,expected)}
 for(const [role,width] of [['employee',1440],['employee',390],['entriesOperator',390]]){
  for(const name of ['bookings','lpr_events','lpr_plate_state','deleted_bookings'])await db.recursiveDelete(db.collection(name))
  await db.doc('config/parkingLive').set({occupiedCount:0})
  const now=wall(),day=now.slice(0,10),arrival=new Date(Date.parse(now)-3600000).toISOString(),number='REST'+width,id='corrected-reservation'
  await db.doc('bookings/'+id).set({licensePlate:'TYPO'+width,clientName:'Recovery fixture',status:'confirmed_paid',paymentStatus:'paid',source:'webhook',startDate:day,startTime:'00:00',endDate:day,endTime:'23:59',createdAt:new Date(),numberOfPersons:2,amount:50})
  const entry=await camera(number,'entry',arrival);assert.ok(entry.matchedBookingId);await total(1)
  const deletion=await request('/api/admin/bookings/delete',{action:'prepare',bookingId:entry.matchedBookingId})
  await request('/api/admin/bookings/delete',{action:'save',bookingId:entry.matchedBookingId,version:deletion.version,requestId:randomUUID(),confirmNotPresent:true});await total(0)
  const correction=await request('/api/admin/bookings/plate',{action:'prepare',bookingId:id,plate:number},role)
  await request('/api/admin/bookings/plate',{action:'save',bookingId:id,plate:number,version:correction.version},role)
  await page.goto('http://localhost:3182/admin/dashboard/entries-exits');await page.evaluate(r=>localStorage.setItem('fixtureRole',r),role)
  await page.setViewportSize({width:1440,height:1000})
  if(role==='employee'){
   await page.goto('http://localhost:3182/admin/dashboard/bookings')
   const row=page.getByRole('row').filter({hasText:'Recovery fixture'});await row.getByRole('button').last().click()
   await page.getByRole('menuitem',{name:'Setează LPR manual (intrare/ieșire)',exact:true}).click()
  }else{await page.reload();await page.getByRole('tab',{name:'Intrări',exact:true}).click();await page.getByRole('button',{name:number,exact:true}).filter({visible:true}).click()}
  await page.setViewportSize({width,height:width===390?844:1000})
  const dlg=page.getByRole('dialog');await expect(dlg).toContainText('Recuperează șederea după corectarea numărului')
  await expect(dlg.getByRole('button',{name:'Recuperează șederea',exact:true})).toBeDisabled()
  await expect(page.locator('#manual-lpr-time')).toHaveValue(arrival.slice(11,19))
  await dlg.getByLabel('Confirm că mașina nu a plecat, este în parcare, iar confirmarea de absență a fost greșită.').check()
  await expect(dlg.getByRole('button',{name:'Recuperează șederea',exact:true})).toBeDisabled()
  await dlg.getByLabel('Motivul rectificării',{exact:true}).fill('Numărul rezervării a fost corectat; șederea LPR a fost ștearsă greșit.')
  await page.screenshot({path:'/tmp/lpr-restore-'+role+'-'+width+'.png'})
  await dlg.getByRole('button',{name:'Recuperează șederea',exact:true}).click();await expect(dlg).toHaveCount(0);await total(1)
  const b=(await db.doc('bookings/'+id).get()).data();assert.equal(b.lpr.isInside,true);assert.equal(b.lpr.visitId,entry.visitId||entry.savedEventId)
  assert.equal((await db.doc('bookings/'+entry.matchedBookingId).get()).exists,false)
  if(role==='employee'){await page.goto('http://localhost:3182/admin/dashboard/ocupare');await expect(page.getByRole('row').filter({hasText:number})).toHaveCount(1);await page.screenshot({path:'/tmp/lpr-restore-occupancy-'+width+'.png'})}
  await new Promise(r=>setTimeout(r,1100));const exit=await camera(number,'exit',wall());assert.equal(exit.matchedBookingId,id);await total(0)
  if(role==='employee'){await page.reload();await expect(page.getByRole('row').filter({hasText:number})).toHaveCount(0)}
  console.log('PASS recovery browser '+role+' '+width+': camera → delete → correct plate → restore → exit; occupancy 1 → 0 → 1 → 0')
 }
 assert.equal(errors.length,0,errors.join('\n'))
}
