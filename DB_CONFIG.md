# Databases

The Rowan PCB Bot uses a Postgres relational database in order to store some cool stats about the service. User uploads are stored on the server for download access, but are not stored in a database.

## Success / Failures
The `stats` database stores the number of pass and fail uploads only.

### Table **stats**
    
    | id integer | name text | count bigint |

## Timestamps
The `timestamps` database stores the timestamp when a PCB design is uploaded. This could give better analysis of when people upload PCBs over the course of a semester.

    | id integer | timestamp bigint |

## Errors
The `errors` database stores the errors that happen whenever a PCB design is uploaded. This is a counter for each error code, which can help show where students typically fail and help train them in the future.

    | id integer | errorCode text | errorMsg text | count bigint |