# Rowan PCB Bot

Rowan students can get their PCB designs validated before sending them to the ECE Tech Office for submission. It also exists as a Slack app to get `zip` files submitted and get inline feedback.

Visit [the website](http://rowan-pcb-bot.herokuapp.com) to try it out (Rowan students & faculty only).

The site includes interesting analysis of submission metadata.

When a PCB is submitted, the bot will check against common issues. If it fails one of these issues, the bot will return with a helpful error message. If all the checks pass, the bot forwards the design to the Tech Office in an email with a download link to the PCB zip file.

## Setup

To run this locally, email configurations need to be set up. An email account needs to be used to generate and send an email. Also, the recipients need to be configured. This should be whoever works in the Tech Office.

If you want to use Slack, you'll need to host the code on a server. You will also need to add the Slack tokens and client information.

## Note on changes
Note that right now the official Heroku-based app is not connected to the GitHub repository. Please contact me in order to sync the two repositories if a change needs to be made. Submit a pull request to this repository with any change.