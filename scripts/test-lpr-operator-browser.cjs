// Loaded by the isolated Next browser harness with LPR_ROLE_FOCUSED=1.
const assert = require('node:assert/strict')
module.exports = async ({page,db,expect,errors}) => {
  const request = async (url, body, token='admin') => {
    const r=await fetch('http://localhost:3182'+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
    const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data
  }
  const wall = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T')+'.000Z'
  const camera = (plate,type,at) => request('/NotificationInfo/TollgateInfo',{Picture:{Plate:{PlateNumber:plate},SnapInfo:{DeviceID:type==='entry'?'intrare_1':'iesire_1',AccurateTime:at}}},'browser-fixture-camera')
  for (const [role,width] of [['employee',1440],['employee',390],['entriesOperator',390]]) {
    await db.recursiveDelete(db.collection('bookings'));await db.recursiveDelete(db.collection('lpr_events'));await db.recursiveDelete(db.collection('lpr_plate_state'))
    await db.doc('config/parkingLive').set({occupiedCount:0})
    const id='reservation-'+role+width,plate='CAR'+width, corrected='FIX'+width, now=wall(),day=now.slice(0,10)
    const arrival=new Date(Date.parse(now)-600000).toISOString()
    const original=await camera(plate,'entry',arrival);assert.ok(original.matchedBookingId)
    await db.doc('bookings/'+id).set({licensePlate:plate,clientName:'Operator fixture',status:'confirmed_paid',paymentStatus:'paid',source:'webhook',startDate:day,startTime:'00:00',endDate:day,endTime:'23:59',createdAt:new Date(),numberOfPersons:2,amount:50})
    await page.goto('http://localhost:3182/admin/dashboard/entries-exits')
    await page.evaluate(role=>localStorage.setItem('fixtureRole',role),role)
    await page.setViewportSize({width:1440,height:1000})
    if(role==='employee') {
      await page.goto('http://localhost:3182/admin/dashboard/bookings')
      const row=page.getByRole('row').filter({hasText:plate}).filter({hasText:'Operator fixture'});await expect(row).toBeVisible()
      await row.getByRole('button').last().click()
      await page.getByRole('menuitem',{name:'Setează LPR manual (intrare/ieșire)',exact:true}).click()
    } else {
      await page.reload();await page.getByRole('tab',{name:'Intrări',exact:true}).click()
      await page.getByRole('button',{name:plate,exact:true}).filter({visible:true}).click()
    }
    await page.setViewportSize({width,height:width===390?844:1000})
    let dialog=page.getByRole('dialog')
    await expect(dialog).toContainText('Asociază șederea LPR cu rezervarea')
    await expect(dialog.getByRole('button',{name:'Asociază șederea',exact:true})).toBeDisabled()
    await dialog.getByLabel('Confirm că mașina este în parcare și această ședere LPR aparține rezervării selectate.').check()
    await page.screenshot({path:'/tmp/parking-associate-'+role+'-'+width+'.png'})
    await dialog.getByRole('button',{name:'Asociază șederea',exact:true}).click();await expect(dialog).toHaveCount(0)
    const occupancy=await request('/api/admin/occupancy');assert.equal(occupancy.occupiedCount,1)
    assert.equal(occupancy.rows?.length??occupancy.occupiedCount,1)
    assert.equal((await db.doc('bookings/'+id).get()).data().lpr.arrivedAt,arrival)
    assert.equal((await db.doc('config/parkingLive').get()).data().occupiedCount,1)
    assert.equal((await db.doc('lpr_plate_state/'+plate).get()).data().bookingId,id)
    // All roles can correct the plate from the shared manual dialog.
    await page.setViewportSize({width:1440,height:1000})
    if(role==='employee') {
      const row=page.getByRole('row').filter({hasText:plate}).filter({hasText:'Operator fixture'});await row.getByRole('button').last().click()
      await page.getByRole('menuitem',{name:'Setează LPR manual (intrare/ieșire)',exact:true}).click()
    } else {
      await page.getByRole('tab',{name:'Ieșiri',exact:true}).click()
      await page.getByRole('button',{name:plate,exact:true}).filter({visible:true}).click()
    }
    await page.setViewportSize({width,height:width===390?844:1000});dialog=page.getByRole('dialog')
    await dialog.getByRole('button',{name:'Modifică numărul de înmatriculare',exact:true}).click()
    await dialog.getByLabel('Număr nou',{exact:true}).fill(corrected)
    await dialog.getByRole('button',{name:'Verifică numărul',exact:true}).click()
    await expect(dialog.getByRole('button',{name:'Salvează numărul',exact:true})).toBeDisabled()
    await dialog.getByLabel('Confirm că este aceeași mașină prezentă și corectez numărul ei real. Șederea rămâne deschisă pe numărul nou.').check()
    await dialog.getByRole('button',{name:'Salvează numărul',exact:true}).click()
    await expect(dialog).toContainText('Nr. înmatriculare: '+corrected)
    await page.screenshot({path:'/tmp/parking-plate-'+role+'-'+width+'.png'})
    await dialog.getByRole('button',{name:'Renunță',exact:true}).click()
    assert.equal((await request('/api/admin/occupancy')).occupiedCount,1)
    assert.equal((await db.doc('lpr_plate_state/'+corrected).get()).data().bookingId,id)
    const corrections=await db.collection('bookings/'+id+'/plateCorrections').get()
    assert.equal(corrections.docs[0].data().actorUid,role+'-fixture')
    if(role==='employee') {
      await page.goto('http://localhost:3182/admin/dashboard/ocupare')
      await expect(page.getByRole('row').filter({hasText:corrected})).toHaveCount(1)
      await page.screenshot({path:'/tmp/parking-occupancy-corrected-'+width+'.png'})
    }
    const exitAt=wall()
    const exited=await camera(corrected,'exit',exitAt);assert.equal(exited.matchedBookingId,id)
    assert.equal((await request('/api/admin/occupancy')).occupiedCount,0)
    assert.equal((await db.doc('config/parkingLive').get()).data().occupiedCount,0)
    if(role==='employee') {
      await page.reload()
      await expect(page.getByRole('row').filter({hasText:corrected})).toHaveCount(0)
    }
    console.log('PASS browser '+role+' '+width+': manual association → plate correction → camera exit; occupancy 1 → 1 → 0')
  }
  assert.equal(errors.length,0,errors.join('\n'))
}
