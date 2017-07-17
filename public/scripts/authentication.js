var DEBUG = true;

$(document).ready(function() {
    console.log("Initializing auth...");
    hello.init({
        google: "196948020908-q8amg46itc1csu9983afrfc2ugqb5162.apps.googleusercontent.com"
    }, {redirect_uri: '/redirect.html'});

    if (localStorage['pcb_bot_auth'] == "true") {
        hello('google').api('me').then(function(r) {
            onUserLoaded(r);
        });
    }

    // TODO Put a nifty thing in the console.
});

function login() {
    hello('google').login("google", {scope: "email"}).then(function() {
        // User signed in
        hello('google').api('me').then(function(r) {
            localStorage['pcb_bot_auth'] = "true";
            onUserLoaded(r);
            window.location.reload();
        });
    }, function(e) {
        console.error("Authentication error: " + e); 
    });
}

function getUserEmail(callback) {
    if (localStorage['pcb_bot_auth'] == "false") {
        callback('');
        return;
    }
    hello('google').api('me').then(function(r) {
        callback(r.email);
    }, function(e) {
        console.error("Authentication error: " + e);
        callback('');
    });
}

function logout() {
    hello('google').logout().then(function() {
        localStorage['pcb_bot_auth'] = "false";
        // Clean up
        $('#profile_image').attr('src', '');
        $('#profile_image').hide();
        $('#profile_name').html('');
        $('#profile_name').hide();
        $('#profile_login').css('display', 'block');
        $('#profile_logout').hide();
    });
}

function onUserLoaded(r) {
    if (DEBUG) {
        console.info(r);
    }
    $('#profile_image').css('display', 'inline');
    $('#profile_image').attr('src', r.picture);
    $('#profile_name').css('display', 'inline-block');
    $('#profile_name').html(r.name);
    $('#profile_login').hide();
    $('#profile_logout').css('display', 'block');   
}

function validEmail(email) {
    // Match: felkern0@students.rowan.edu
    // Match: polikar@rowan.edu
    // No Match: handnf@gmail.com
    if (email.match(/[a-zA-Z0-9]+@(students[.]|)rowan[.]edu/g)) {
        return true;
    }
    return false;
}
