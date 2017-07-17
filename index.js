"use strict"
const express = require('express');
const fileUpload = require('express-fileupload');
const app = express();
const DEBUG = true;

/* 
 * NOTE If you're using some GMail to send emails, make sure that "Less Secure" apps is enabled on Google account.
 * If we move to a new domain, we NEED to update the `downloadUrl` parameter.
 * https://nodemailer.com/usage/using-gmail/
 */

const SOURCE_EMAIL = "";
const SOURCE_PASSWORD = "";
const RECIPIENT_EMAILS = ""; // Comma-separated string of email addresses that PCB submission should go to. All recipients are CC'd, allowing for an email thread.

const SLACK_TOKEN = ""; // FIXME No constant
const SLACK_TEMP_ACCESS = "";

const SLACK_CLIENT_ID = "";
const SLACK_SECRET = "";
const SLACK_VERIFICATION_TOKEN = "";

function addError(code, reason, obj) {
    obj['errors'].push({code: code, msg: reason});
    return obj;
}

// Store errors in the database
//   @param errorsArray - An array of error `code`s and `msg`s
function reportErrors(errorsArray) {
    var pg = require('pg');
    console.log(errorsArray);
    // First connect to DB
    pg.connect(process.env.DATABASE_URL, function(err, client, done) {
        if (!client || err) {
            console.error(err);
            // Well this should not happen. :o
            return;
        }
        // Update `STATS`
        if (errorsArray.length > 0) { // There's one error
            client.query('SELECT * FROM stats WHERE id = 1;', function(err, result) {
                done();
                if (err) {
                    console.error(err); response.send("Error " + err);
                } else {
                    // Update DB
                    result.rows[0]['count']++;
                    client.query('UPDATE stats SET count = ' + result.rows[0]['count'] + ' WHERE id = 1;', function(err, result) {
                        console.log(err);
                    });
                }
            });
        } else {
            client.query('SELECT * FROM stats WHERE id = 0;', function(err, result) {
                done();
                if (err) {
                    console.error(err); response.send("Error " + err);
                } else {
                    // Update DB
                    result.rows[0]['count']++;
                    client.query('UPDATE stats SET count = ' + result.rows[0]['count'] + ' WHERE id = 0;', function(err, result) {
                        console.log(err);
                    });
                }
            });
        }

        // Update `TIMESTAMPS`
        client.query("INSERT INTO timestamps(\"timestamp\") values (" + new Date().getTime() + ");");

        // Update `ERRORS`
        // Do each error report in succession to avoid any race condition.
        recordErrorCode(client, errorsArray, 0);
    });
}

function recordErrorCode(client, errorsArray, index) {
    console.log("Record error code " + index);
    var errlabels = {
        "1": "No file sent",
        "2": "File not zip",
        "3": "Zip named wrong",
        "4": "Error storing zip",
        "5": "Files named wrong",
        "6": "Unwanted file included",
        "7": "Error processing zip",
        "8": "Missing expected files",
        "9": "Miscellaneous upload error"
    };
    if (index >= errorsArray.length) {
        return;
    }
    var c = errorsArray[index].code;
    // Present short labels for each code for displaying in DB and graphs
    if (errlabels[c]) {
        var m = errlabels[c];
    } else {
        var m = "Error " + c;
    }
    console.log("Update error " + c);
    client.query('SELECT * FROM errors WHERE errorcode = \'' + c + '\';', function(err, result) {
        if (!err) {
            if (result.rows.length == 0) {
                console.log('INSERT INTO errors("errorcode", "errormsg", "count") values(\'' + c + '\', \'' + m + '\', 1);');
                client.query('INSERT INTO errors("errorcode", "errormsg", "count") values(\'' + c + '\', \'' + m + '\', 1);', function(err, result) {
                    console.log('a', err);
                    setTimeout(function(client, errorsArray, index) {
                        recordErrorCode(client, errorsArray, index + 1);
                    }, 25, client, errorsArray, index);
                });
            } else {
                result.rows[0]['count']++;
                console.log('UPDATE errors SET count = ' + result.rows[0]['count'] + ', errormsg = \'' + m + '\' WHERE errorcode = \'' + c + '\';');
                client.query('UPDATE errors SET count = ' + result.rows[0]['count'] + ', errormsg = \'' + m + '\' WHERE errorcode = \'' + c + '\';', function(err, result) {
                    console.log('b', err);
                    setTimeout(function(client, errorsArray, index) {
                        recordErrorCode(client, errorsArray, index + 1);
                    }, 25, client, errorsArray, index);
                });
            }
        } else {
            console.log('c', err);
            setTimeout(function() {
                recordErrorCode(client, errorsArray, index + 1);
            }, 300);
        }
    });
}

// Downloads from a pre-existing Url.
function processPcbFile(fileUrl, fileName, emailAddress, callback) {
    var fs = require('fs');
    let folder = emailAddress;
    if (emailAddress.indexOf('@') > -1) {
        folder = emailAddress.substring(0, emailAddress.indexOf('@'));
    }

    console.log("Moving file into " + folder);
    // Create directories if necessary.
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads');
    }

    if (!fs.existsSync('uploads/' + folder)) {
        fs.mkdirSync('uploads/' + folder);
    }

    let filePath = 'uploads/' + folder + '/pcb_' + fileName;
    console.log("Moving file into " + filePath);
    // Create filestream and pull data into here.
    let file = fs.createWriteStream(filePath);
    var request = require('request');
    // Make sure we include an Authoriziation token in order to download from URL
    let req = request.get({url: fileUrl, headers: {Authorization: 'Bearer ' + SLACK_TOKEN}});

    req.on('response', function(response) {
        console.log(fileUrl);
    });
    req.pipe(file);
    file.on('finish', function() {
        console.log("Movement finished");
        file.close(function() {
            console.log("File closing");
            try {
                finishPcbProcessing(folder, fileName, undefined, callback);
            } catch (e) {
                // I'm not entirely sure what to do with this error.
                // Don't break things.
                console.warn(e);
            }
        });
    })
    file.on('error', function(err) {
        console.log(err);
    });
    req.on('error', function(err) {
        console.log(err);
    });
}

// Receives a zip file and processes it to obtain any errors that may be found.
function processPcbUpload(request, response, callback) {
    console.log("Getting form data");
    // Zip file is at req.files.{input name}
    // https://www.npmjs.com/package/express-fileupload
    let fail = false;
    let reasons = {
        "status": 200,
        "errors": []
    };
    if (!request.files || request.files.zip_upload == undefined) {
        reasons = addError(1, "No file was sent", reasons);
    }
    let upload = request.files.zip_upload;
    console.log("Received ", upload);
    if (upload.name.substr(-3).toLowerCase() != 'zip' || upload.mimetype.toLowerCase() != 'application/x-zip-compressed') {
        reasons = addError(2, "Upload is the wrong type. It must be a zip.", reasons);
    }

    if (reasons.errors.length) {
        // Bail early
        reasons['status'] = 400;
        reportErrors(reasons['errors']);
        callback(reasons);
        return;
    }

    reasons['email'] = request.body.user_email;
    let folder = request.body.user_email.substring(0, request.body.user_email.indexOf('@'));
    // Match the name
    /* "Each student/team should name their files as follows:
     *   Filename root syntax: ccccc-ss_uuuuuu_d_q.xxx
     *   ccccc = 5 digit course number
     *   ss = 2 digit section number
     *   uuuuuu = Rowan username (obtained through the 'folder' variable)
     *   d = design number (d/total for multi-design)
     *   q = quantity of boards needed
     */
    var nameMatch = /[0-9]{5}-[0-9]{2}_[a-zA-Z0-9]+_[0-9]+_[0-9]+/g;
    if (!upload.name.match(nameMatch)) {
        // Find out exactly what's going on.
        reasons = addError(3, "Your project should be named as follows: `ccccc-ss_uuuuuu_d_q.xxx`", reasons);
        if (!upload.name.substring(0, 5).match(/[0-9]{5}/)) {
            reasons = addError(3.1, "ccccc = 5 digit course number", reasons);
        }
        if (!upload.name.substring(6, 8).match(/[0-9]{2}/)) {
            reasons = addError(3.2, "ss = 2 digit section number", reasons);
        }
        if (!upload.name.substring(9, upload.name.indexOf('_', 9)).match(/[a-zA-Z]+[a-zA-Z0-9]/g)) {
            reasons = addError(3.3, "uuuuu = Rowan username", reasons);
        }
        if (!upload.name.substring(upload.name.indexOf('_', 9)).match(/[0-9]+_[0-9]+/)) {
            reasons = addError(3.5, "d = design number (d/total with multiple designs)<br>q = quantity of boards needed", reasons);
        }
    }
    if (upload.name.substring(9, upload.name.indexOf('_', 9)) != folder) {
        reasons = addError(3.4, "uuuuu = <strong>Your</strong> Rowan username, not for someone else.", reasons);
    }

    // Okay, now we are ready to process the actual data in the file.
    // Create directories
    const fs = require('fs');
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads');
    }

    if (!fs.existsSync('uploads/' + folder)) {
        fs.mkdirSync('uploads/' + folder);
    }
    // Now save it.
    upload.mv('uploads/' + folder + '/pcb_' + upload.name, function(err) {
        if (err) {
            reasons = addError(4, err, reasons);
        }
        try {
            finishPcbProcessing(folder, upload.name, reasons, callback);
        } catch (e) {
            console.warn(e);
            // I'm not entirely sure what to do with this error.
            // Don't break things.
        }
    });
}

function finishPcbProcessing(username, filename, reasons, callback) {
    // Pass this value if we want to use it in the future.
    if (!reasons) {
        // Create this now.
        var reasons = {
            "status": 200,
            "errors": []
        };
    }
    console.log("Our directory name is " + __dirname);
    reasons['downloadUrl'] = __dirname + '/uploads/' + username + '/pcb_' + filename;
    console.log(__dirname + '/uploads/' + username + '/pcb_' + filename);
    reasons['downloadName'] = filename;

    const unzip = require('unzip');
    const fs = require('fs');

    let fileCount = 0;
    let calledback = false;
    let allFiles = [];
    let expectedFiles = ['gto', 'gts', 'gtl', 'gbl', 'gbs', 'gbo', 'gko', 'xln'];
    let expectedFileCount = expectedFiles.length;
    fs.createReadStream(__dirname + '/uploads/' + username + '/pcb_' + filename)
        .pipe(unzip.Parse())
        // Right now we just stream each zip file metadata and don't open any directly. But we could do that.
        .on('entry', function(entry) {
            console.log(entry.path);
            let fileExt = entry.path.substr(-3);
            // Check whether the file has the same name.
            if (entry.path.substring(0, entry.path.length - 3) != filename.substring(0, filename.length - 3)) {
                reasons = addError(5, "Every filename should be the same: '" + entry.path + "' != '" + filename + "'" , reasons);
            }
            if (expectedFiles.indexOf(fileExt) == -1) {
                reasons = addError(6, "Unexpected extension <code>" + fileExt + "</code> found for file " + entry.path, reasons);
            } else {
                fileCount++;
                expectedFiles.splice(expectedFiles.indexOf(fileExt), 1);
            }
            entry.autodrain();
        })
        .on('error', function(err) {
            reasons = addError(7, err.message, reasons);
            reasons['status'] = 400;
            // Abort
            if (!calledback) {
                reportErrors(reasons['errors']);
                callback(reasons);
                calledback = true;
            }
            return;
        })
        .on('end', function() {
            console.log("Ended zip read");
        })
        .on('finish', function() {
            setTimeout(function() {
                console.log("Finished zip read");
                if (expectedFiles.length) {
                    reasons = addError(8, "Expecting filetypes that were not found: <code>" + expectedFiles.join('</code>, <code>') + "</code>", reasons);
                }
                if (reasons.errors.length) {
                    reasons['status'] = 400;
                }
                if (!calledback) {
                    try {
                        reportErrors(reasons['errors']);
                    } catch (e) {
                        console.warn("Okay, we did not save errors.", e);
                    }
                    callback(reasons);
                    calledback = true;
                }
                return;
            }, 1000);
        });
}


function submitPcbEmail(data) {
    console.log("Send an email");
    console.log(data);
    const nodemailer = require('nodemailer');
    // create reusable transporter object using the default SMTP transport
    let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: SOURCE_EMAIL,
            pass: SOURCE_PASSWORD
        }
    });

    // setup email data with unicode symbols
    let mailOptions = {
        from: '"' + data['email'] + '" <' + data['email'] + '>', // sender address
        to: data['email'] + ', ' + RECIPIENT_EMAILS, // list of receivers.
        subject: 'ECEBR', // Subject line
        text: 'Good day. A PCB was submitted and automatically verified using the Rowan PCB Bot. See the included design. If there is a problem, you can use this email thread to discuss specifics. ' + data['downloadUrl'] + 'Thanks, Rowan PCB Bot.', // plain text body
        html: 'Good day.<p>A PCB was submitted and automatically verified using the Rowan PCB Bot. See the attached design.</p> <p>If there is a problem, you can use this email thread to discuss specifics.</p> <p>Click to download <a href="' + data['downloadUrl'] + '">' + data['downloadName'] + '</a><br>Thanks,<br>Rowan PCB Bot.', // html body
        attachements: [{
            filename: data['downloadName'],
            path: data['downloadUrl']
        }]
    };

    // send mail with defined transport object
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log(error);
        }
        console.log('Message %s sent: %s', info.messageId, info.response);
    });
}

app.set('port', (process.env.PORT || 5000));

app.use(express.static(__dirname + '/public'));
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
})); // Using default options

// views is directory for all template files
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.get('/', function(request, response) {
    var sresult = null;
    var tresult = null;
    var eresult = null;
    var pg = require('pg');
    // First connect to DB
    pg.connect(process.env.DATABASE_URL, function(err, client, done) {
        if (!client) {
            console.error(err);
            response.render('pages/index', {sresult: undefined, tresult: undefined, eresult: undefined});
            return;
        }
        client.query('SELECT * FROM stats', function(err, result) {
            sresult = result;
            client.query('SELECT * FROM timestamps', function(err, result) {
                tresult = result;
                client.query('SELECT * FROM errors', function(err, result) {
                    eresult = result;
                    response.render('pages/index', {sresult: sresult, tresult: tresult, eresult: eresult});
                });
            });
        });
    });
});

app.get('/redirect.html', function(request, response) {
    // Send the user to the OAuth handler page
    response.render('pages/redirect');
}); 

app.get('/upload', function(request, response) {
    // Send the user to the OAuth handler page
    response.render('pages/upload');
});

app.post('/upload', function(request, response) {
    // Process what the user has requested
    try {
        processPcbUpload(request, response, function(output) {
//            console.log(output);
            if (output['status'] == 200) {
                // Handle zip, ie. email it
                submitPcbEmail(output);
            }
            response.render('pages/upload', {result: output});
        });
    } catch (err) {
        let reasons = {
            "status": 400,
            "errors": []
        };
        reasons = addError(9, err.message, reasons);
        reportErrors(reasons.errors);
        response.render('pages/upload', {result: reasons});
    }
});

app.get('/uploads/:uid/:name', function(request, response) {
    // Let them open the file
    // Maybe one day we can show a prettier user interface
    response.download(__dirname + '/uploads/' + request.params.uid + '/' + request.params.name);
});

app.post('/api/v1/pcb', function(request, response) {
    try {
        processPcbUpload(request, response, function(output) {
            if (output['status'] == 200) {
                // Handle zip, ie. email it
                submitPcbEmail(output);
            }
            // Output JSON
            response.status(output['status']).send(JSON.stringify(output));
        });
    } catch (err) {
        let reasons = {
            "status": 400,
            "errors": []
        };
        reasons = addError(9, err.message, reasons);
        reportErrors(reasons.errors);
        response.status(reasons['status']).send(JSON.stringify(reasons));
    }
});

var bodyParser = require('body-parser');

app.use(bodyParser.json()); // Enable middleware to convert JSON into body params

app.get('/api/v1/slack/action-endpoint', function(request, response) {
    response.status(200).send('You should not be here.');
});

function postSlackMsg(channel, msg) {
    var postRequest = require('request');
    postRequest.get('https://slack.com/api/chat.postMessage?token=' + SLACK_TOKEN + '&channel=' + channel + '&text=' + msg + '&link_names=true', {},
                     function(error, response, body) {

    });
}

function requestSlackToken(callback) {
    var postRequest = require('request');
//    postRequest.post('
}

// OAUth Url: https://slack.com/oauth/authorize?client_id=76700000960.172250431152&scope=files%3Aread%2Cchat%3Awrite%3Abot,users:read,users:read.email&team=1
// OAUth Url: https://memsat.slack.com/oauth?client_id=76700000960.172250431152&scope=files%3Aread%2Cchat%3Awrite%3Abot&team=1
// TODO Get a TOKENS database to store tokens per team
app.get('/api/v1/slack/redirect', function(request, response) {
//    console.log(request);
    console.log(request.query.code);
    var postRequest = require('request');
    postRequest.get('https://slack.com/api/oauth.access?client_id=' + SLACK_CLIENT_ID + '&client_secret=' + SLACK_SECRET + '&code=' + request.query.code, {}, function(err, response, body) {
        if (!err && response.statusCode == 200) {
            console.log(body);
            if (body.ok) {
                // TODO Something with access-token
            } else {
                console.error(body.error);
            }
        } else {
            console.error(err);
        }
    });
});

app.post('/api/v1/slack/action-endpoint', function(request, response) {
    let data = request.body;
    console.log(request.body);
    console.log(request.body.body);
    if (data && data.challenge) {
        response.status(200).send(data.challenge);
    } else if (data.event && data.event.type == "file_created") {
        // We can handle a file!
        // First we need to find out where the file is stored.
        // https://slack.com/api/files.info
        var postRequest = require('request');
        console.log("Make a request to " + 'https://slack.com/api/files.info?token=' + SLACK_TOKEN + '&file=' + data.event.file_id);
        postRequest.get('https://slack.com/api/files.info?token=' + SLACK_TOKEN + '&file=' + data.event.file_id,
                         {},
                         function(error, response, body) {
            body = JSON.parse(body);
            console.log(body);
            if (body.ok) {
                // TODO Pre-check if it's a zip
                let zip = true;
                if (body.file.name.substr(-3) != "zip") {
                    zip = false;
                    // Don't process a non-zip file.
                    return;
                }
                // Now we need to know who uploaded this file.
                postRequest.get('https://slack.com/api/users.info?token=' + SLACK_TOKEN + '&user=' + body.file.user, {}, function(error, response, userbody) {
                    userbody = JSON.parse(userbody);
                    console.log(userbody);
                    if (userbody.ok) {
                        // Send message
                        var msg = "Hey @" + userbody.user.name + ", I'll take a look at your PCB!";
                        if (userbody.user.profile.first_name) {
                            msg = "Hey " + userbody.user.profile.first_name + ", I'll take a look at your PCB!";
                        }
                        var room;
                        if (body.file.channels) {
                            room = body.file.channels[0];
                        } else if (body.file.groups) {
                            room = body.file.groups[0];
                        } else {
                            return; // Nowhere to post this!
                        }
                        console.log("Sending a message! " + msg);
                        postSlackMsg(room, msg);
                        setTimeout(function() {
                            processPcbFile( body.file.url_private_download, body.file.name, userbody.user.profile.email || userbody.user.name, function(output) {
                                if (output['status'] == 200) {
                                    // Handle zip, ie. email it
                                    submitPcbEmail(output);
                                }
                                // Output message.
                                var msg = "Looks good to me! I'll forward this to the ECE techs! You should be receiving a confirmation email shortly.";
                                if (output.errors.length <= 0) {

                                } else if (output.errors.length == 1) {
                                    msg = "This is almost perfect, you've just got one issue: " + output.errors[0].msg + " (" + output.errors[0].code + "). Please make that fix and submit it again.";
                                } else if (output.errors.length < 5) {
                                    msg = "Hey, you have a few issues. Please check them out before resubmitting: ";
                                    for (var i in output.errors) {
                                        msg += output.errors[i].msg + " (" + output.errors[i].code + "). ";
                                    }
                                } else {
                                    msg = "Hey, you have " + output.errors.length + " problems in your design. ";
                                    for (i in output.errors) {
                                        msg += output.errors[i].msg + " (" + output.errors[i].code + "). ";
                                    }
                                    msg += "Make those fixes before submitting"; // Notably less polite now. :/
                                }
                                postSlackMsg(room, msg);
                            });
                        }, 1000); // Add some delay to parallelize.
                    } else {
                        console.error(userbody.error);
                    }
                });
            } else {
                console.error(body.error);
            }
        });
        // Send an OK quickly and process afterward
    }
    response.status(200).send('Nothing');
});

app.listen(app.get('port'), function() {
    console.log('Node app is running on port', app.get('port'));
});

app.use(function (request, response, next) {
    // TODO Create a 404 page
    response.status(404).send("Sorry can't find that!");
});
