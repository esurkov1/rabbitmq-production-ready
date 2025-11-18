# Security Policy

## Supported Versions

We actively support the latest version of this library. Security updates will be provided for:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue. Instead, please report it via one of the following methods:

1. **GitHub Security Advisory**: Use the [GitHub Security Advisory](https://github.com/esurkov1/rabbitmq-production-ready/security/advisories/new) feature
2. **Email**: Contact the maintainer directly at [GitHub profile](https://github.com/esurkov1)

Please include the following information:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt of your report within 48 hours and provide an update on the status of the vulnerability within 7 days.

## Security Best Practices

When using this library:

1. **Connection Strings**: Never commit connection strings with credentials to version control
2. **TLS/SSL**: Use `amqps://` URLs in production for encrypted connections
3. **Credentials**: Store credentials in environment variables or secure secret management systems
4. **Network**: Restrict RabbitMQ access to trusted networks only
5. **Updates**: Keep the library and its dependencies up to date

## Known Security Considerations

- This library handles connection strings that may contain credentials. Ensure proper logging configuration to avoid logging sensitive information
- The library does not encrypt messages by default - use RabbitMQ TLS/SSL for encrypted transport
- Dead Letter Queue (DLQ) may contain sensitive message content - ensure proper access controls

