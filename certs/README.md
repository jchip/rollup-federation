## SSL certs for localhost to do https.

Using hostname: `localhost.mycdn.net`

- generated on Mac
- config file copied from `/etc/ssl/openssl.cnf` with the following additions:

```ini
[ext]
basicConstraints=critical,CA:TRUE,pathlen:0
[SAN]
subjectAltName=DNS:localhost.mycdn.net,IP:127.0.0.1
```

- certs generated with following command

```
openssl req -new -x509 -nodes -sha256 -days 3650 -newkey rsa:2048 -out dev.cer -keyout dev.key -extensions SAN -reqexts SAN -subj /CN=localhost.mycdn.net -config local-ssl.cnf
```

## Register to System KeyChain on MacOS

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain dev.cer
```

Add the following line to `/etc/hosts`

```
127.0.0.1 localhost.mycdn.net
```
