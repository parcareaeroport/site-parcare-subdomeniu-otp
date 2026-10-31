// Run through the actual Next pages/API, using the local-emulator harness.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
module.exports=async({page,db,expect,errors})=>{
 const request=async(url,body,token='admin')=>{const r=await fetch('http://localhost:3182'+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data}
 const wall=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T')+'.000Z'
 const camera=(number,type,at)=>request('/NotificationInfo/TollgateInfo',{Picture:{Plate:{PlateNumber:number},SnapInfo:{DeviceID:type==='entry'?'intrare_1':'iesire_1',AccurateTime:at}}},'browser-fixture-camera')
 const total=async expected=>{assert.equal((await request('/api/admin/occupancy')).occupiedCount,expected);assert.equal((await db.doc('config/parkingLive').get()).data().occupiedCount,expected)}
 for(const [role,width,newArrival,unchangedEarly] of [['employee',1440,false,false],['employee',390,false,false],['entriesOperator',390,false,false],['employee',1440,true,false],['employee',1440,false,true],['entriesOperator',390,false,true],['employee',390,true,true]]){
  for(const name of ['bookings','lpr_events','lpr_plate_state','deleted_bookings'])await db.recursiveDelete(db.collection(name))
  await db.doc('config/parkingLive').set({occupiedCount:0})
  const now=wall(),day=now.slice(0,10),arrival=new Date(Date.parse(now)-3600000).toISOString(),number='REST'+width,id='corrected-reservation'
  const start=new Date(Date.parse(now)+6*3600000).toISOString(),end=new Date(Date.parse(now)+4*86400000).toISOString()
  await db.doc('bookings/'+id).set({licensePlate:unchangedEarly?number:'TYPO'+width,clientName:'Recovery fixture',status:'confirmed_paid',paymentStatus:'paid',source:'webhook',
   startDate:unchangedEarly?start.slice(0,10):day,startTime:unchangedEarly?start.slice(11,16):'00:00',endDate:unchangedEarly?end.slice(0,10):day,endTime:unchangedEarly?end.slice(11,16):'23:59',createdAt:new Date(),numberOfPersons:2,amount:50})
  const entry=await camera(number,'entry',arrival);assert.ok(entry.matchedBookingId);await total(1)
  const deletion=await request('/api/admin/bookings/delete',{action:'prepare',bookingId:entry.matchedBookingId})
  await request('/api/admin/bookings/delete',{action:'save',bookingId:entry.matchedBookingId,version:deletion.version,requestId:randomUUID(),confirmNotPresent:true});await total(0)
  if(!unchangedEarly){const correction=await request('/api/admin/bookings/plate',{action:'prepare',bookingId:id,plate:number},role)
  await request('/api/admin/bookings/plate',{action:'save',bookingId:id,plate:number,version:correction.version},role)}
  await page.goto('http://localhost:3182/admin/dashboard/entries-exits');await page.evaluate(r=>localStorage.setItem('fixtureRole',r),role)
  await page.setViewportSize({width:1440,height:1000})
  if(role==='employee'){
   await page.goto('http://localhost:3182/admin/dashboard/bookings')
   const row=page.getByRole('row').filter({hasText:'Recovery fixture'});await row.getByRole('button').last().click()
   await page.getByRole('menuitem',{name:'Setează LPR manual (intrare/ieșire)',exact:true}).click()
  }else{await page.reload();await page.getByRole('tab',{name:'Intrări',exact:true}).click();await page.getByRole('button',{name:number,exact:true}).filter({visible:true}).click()}
  await page.setViewportSize({width,height:width===390?844:1000})
  const dlg=page.getByRole('dialog');await expect(dlg).toContainText('Înregistrează intrarea')
  await expect(dlg.locator('#manual-entry-operation')).toHaveCount(0)
  await expect(dlg.locator('#entry-restoration-reason')).toHaveCount(0)
  await expect(dlg.locator('.bg-amber-50')).toHaveCount(0)
  await expect(dlg.getByRole('button',{name:'Salvează',exact:true})).toBeDisabled()
  await expect(page.locator('#manual-lpr-time')).toHaveValue(arrival.slice(11,19))
  if(role==='employee' && width===1440 && !newArrival){
   await page.locator('#manual-lpr-type').click()
   const option=page.getByRole('option',{name:'Ieșire',exact:true});await option.hover()
   await expect(option).toHaveCSS('color','rgb(255, 255, 255)')
   assert.notEqual(await option.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)')
   await page.screenshot({path:'/tmp/lpr-entry-hover.png'})
   await page.keyboard.press('Escape')
   console.log('PASS dropdown hover uses white text on blue background')
  }
  const confirmation=dlg.getByLabel('Confirm că mașina este în parcare de la data și ora indicate.')
  await confirmation.check()
  // Editing the arrival invalidates the previous acknowledgement.
  await page.locator('#manual-lpr-time').fill(new Date(Date.parse(arrival)+1000).toISOString().slice(11,19))
  await expect(confirmation).not.toBeChecked();await expect(dlg.getByRole('button',{name:'Salvează',exact:true})).toBeDisabled()
  if(newArrival){await new Promise(r=>setTimeout(r,1100));await dlg.getByRole('button',{name:'A sosit acum',exact:true}).click()}
  await confirmation.check()
  await page.screenshot({path:'/tmp/lpr-restore-'+role+'-'+width+'.png'})
  const saving=page.waitForRequest(r=>r.url().endsWith('/api/admin/manual-lpr-entry')&&r.method()==='POST'&&r.postDataJSON()?.action==='save')
  await dlg.getByRole('button',{name:'Salvează',exact:true}).click();const payload=(await saving).postDataJSON()
  assert.equal(payload.entryMode,newArrival?'new_visit':'restore_deleted_visit')
  if(!newArrival){assert.equal(payload.confirmRestoration,true);assert.ok(payload.restorationReason.length>=5)}
  await expect(dlg).toHaveCount(0);await total(1)
  const b=(await db.doc('bookings/'+id).get()).data();assert.equal(b.lpr.isInside,true)
  if(newArrival)assert.notEqual(b.lpr.visitId,entry.visitId||entry.savedEventId)
  else assert.equal(b.lpr.visitId,entry.visitId||entry.savedEventId)
  assert.equal((await db.doc('bookings/'+entry.matchedBookingId).get()).exists,false)
  if(role==='employee'){await page.goto('http://localhost:3182/admin/dashboard/ocupare');await expect(page.getByRole('row').filter({hasText:number})).toHaveCount(1);await page.screenshot({path:'/tmp/lpr-restore-occupancy-'+width+'.png'})}
  await new Promise(r=>setTimeout(r,1100));const exit=await camera(number,'exit',wall());assert.equal(exit.matchedBookingId,id);await total(0)
  if(role==='employee'){await page.reload();await expect(page.getByRole('row').filter({hasText:number})).toHaveCount(0)}
  if(newArrival && unchangedEarly){
   await page.setViewportSize({width:1440,height:1000});await page.goto('http://localhost:3182/admin/dashboard/bookings')
   await page.getByRole('row').filter({hasText:'Recovery fixture'}).getByRole('button').last().click()
   await page.getByRole('menuitem',{name:'Setează LPR manual (intrare/ieșire)',exact:true}).click()
   const again=page.getByRole('dialog');await expect(again).toContainText('Înregistrează o intrare nouă')
   await expect(again.getByRole('checkbox')).toHaveCount(1)
   await new Promise(r=>setTimeout(r,1100));await again.getByRole('button',{name:'A sosit acum',exact:true}).click()
   await again.getByLabel('Confirm că mașina a reintrat fizic în parcare.').check()
   await again.getByRole('button',{name:'Salvează',exact:true}).click();await expect(again).toHaveCount(0);await total(1)
   await new Promise(r=>setTimeout(r,1100));assert.equal((await camera(number,'exit',wall())).matchedBookingId,id);await total(0)
   console.log('PASS real reentry outside booking period uses one confirmation and counts once')
  }
  console.log('PASS minimal entry browser '+role+' '+width+' '+(newArrival?'new physical arrival':'restore')+' '+(unchangedEarly?'unchanged plate, early arrival':'corrected plate')+': occupancy 1 → 0 → 1 → 0')
 }
 assert.equal(errors.length,0,errors.join('\n'))
}
