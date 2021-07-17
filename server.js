const express = require("express");
const fetch = require('cross-fetch');
const CRED = require("@pathcheck/cred-sdk");

const app = express();

var bodyParser = require("body-parser");
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: false }));

const port = process.env.PORT || "8000";

const privateKey = `-----BEGIN EC PARAMETERS-----
BgUrgQQACg==
-----END EC PARAMETERS-----
-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIPWKbSezZMY1gCpvN42yaVv76Lo47FvSsVZpQl0a5lWRoAcGBSuBBAAK
oUQDQgAE6DeIun4EgMBLUmbtjQw7DilMJ82YIvOR2jz/IK0R/F7/zXY1z+gqvFXf
DcJqR5clbAYlO9lHmvb4lsPLZHjugQ==
-----END EC PRIVATE KEY-----`

const publicKeyLink = '1A9.PCF.PW';

function getColorAPIURL(publicURL) {
  let urlMain = publicURL.split("?")[0];
  let queryString = publicURL.split("?")[1];

  let userid = urlMain.split('/')[5];
  let token = new URLSearchParams(queryString).get('claim_token'); 

  return "https://home.color.com/api/v1/vaccination_appointments/"+userid+"?claim_token="+token;
}

async function load(url) {
    try {
      const res = await fetch(url);
      
      if (res.status >= 400) {
        console.log(res);
        throw new Error("Bad response from server");
      }
      
      return await res.json();
    } catch (err) {
      console.error(err);
      return undefined;
    }
}

function convertPreviousApptToBadgeArray(data) { 
    if (data && data.previous_appointment && data.previous_appointment.vaccination_record) {
        let firstDate = new Date(data.previous_appointment.vaccination_record.vaccination_date);
        let secondDate = new Date(data.vaccination_record.vaccination_date);

        const diffTime = Math.abs(secondDate - firstDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        return [
            data.previous_appointment.vaccination_record.vaccination_date, //date
            data.previous_appointment.vaccination_record.manufacturer,  // manuf
            data.vaccination_record.type.replaceAll(data.vaccination_record.manufacturer + " ", ""), // product
            data.previous_appointment.vaccination_record.substance_lot_number, // type
            diffDays.toString(), //doses
            , //vaccinee
            , //route
            data.previous_appointment.vaccination_record.administration_site, //site
            (data.previous_appointment.vaccination_record.administered_amount_in_ml*1000).toString(), //dose
            data.first_name + " " + data.last_name,  //name
            data.birthday //dob
        ];
    } else {
        return undefined;
    }
}

function convertColorToBadgeArray(data) { 
    if (data && data.vaccination_record) {
        let diffDays = "";
        if (data.next_appointment) {
            let firstDate = new Date(data.previous_appointment.vaccination_record.vaccination_date);
            let secondDate = new Date(data.next_appointment);

            const diffTime = Math.abs(secondDate - firstDate);
            diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        }
        
        return [
            data.vaccination_record.vaccination_date,
            data.vaccination_record.manufacturer, 
            data.vaccination_record.type.replaceAll(data.vaccination_record.manufacturer + " ", ""), // product
            data.vaccination_record.substance_lot_number, 
            diffDays,
            , //vaccinee
            , //route
            data.vaccination_record.administration_site, //site
            (data.vaccination_record.administered_amount_in_ml*1000).toString(), //dose
            data.first_name + " " + data.last_name,  //name
            data.birthday //dob
        ];
    } else {
        return undefined;
    }
}

function getInitialsAndYear(fullName, dob) {
    var names = fullName.split(' '),
        initials = names[0].substring(0, 1).toUpperCase();
    
    if (names.length > 1) {
        initials += names[names.length - 1].substring(0, 1).toUpperCase();
    }

    return initials + dob.substring(2,4);
}

function getDoses(badgeArrayCurr, badgeArrayPrevious) {
    if (!badgeArrayCurr) return "0";
    if (badgeArrayCurr.next_appointment) return "1";
    return "2";
}

async function sign(_type, _version, priKeyPEM, pubKeyId, payloadValueArray) {
    return await CRED.signAndPack(_type, _version, priKeyPEM, pubKeyId, payloadValueArray);
}

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});

app.post('/create', async function (req, res) {
    var colorRecord = await load(getColorAPIURL(req.body.url));

    let signedCerts = {
      raw: colorRecord
    }

    if (!colorRecord) {
      res.send(signedCerts);
      return;
    }

    const badgeArrayCurr = convertColorToBadgeArray(colorRecord);
    const badgeArrayPrevious = convertPreviousApptToBadgeArray(colorRecord);

    if (badgeArrayPrevious && badgeArrayCurr) {
        signedCerts['firstImmunizationQR'] = await sign("badge","2", privateKey, publicKeyLink, badgeArrayPrevious);
        signedCerts['secondImmunizationQR'] = await sign("badge","2", privateKey, publicKeyLink, badgeArrayCurr);
    } else if (!badgeArrayPrevious && badgeArrayCurr) {
        signedCerts['firstImmunizationQR'] = await sign("badge","2", privateKey, publicKeyLink, badgeArrayCurr);
    } else {
        
    }

    const initals = getInitialsAndYear(badgeArrayCurr[9], badgeArrayCurr[10]);
    const statusArray = [getDoses(badgeArrayCurr,badgeArrayPrevious),,initals];
    signedCerts['immunizationStatusQR'] = await sign("status","2", privateKey, publicKeyLink, statusArray);

    res.send(signedCerts);
});

app.listen(port, () => {
  console.log(`Listening to requests on http://localhost:${port}`);
});