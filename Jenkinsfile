pipeline {
    agent { label 'node22-linux' }

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds(abortPrevious: true)
        timeout(time: 20, unit: 'MINUTES')
        timestamps()
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install') {
            steps {
                sh 'node --version'
                sh 'npm --version'
                sh 'npm ci'
            }
        }

        stage('Verify') {
            parallel {
                stage('Test') {
                    steps {
                        sh 'npm test'
                    }
                }

                stage('Lint') {
                    steps {
                        sh 'npm run lint'
                    }
                }
            }
        }

        stage('Build') {
            environment {
                NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY = credentials('kakao-map-javascript-key')
                NEXT_PUBLIC_FIREBASE_API_KEY = credentials('firebase-web-api-key')
                NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = credentials('firebase-auth-domain')
                NEXT_PUBLIC_FIREBASE_PROJECT_ID = credentials('firebase-project-id')
                NEXT_PUBLIC_FIREBASE_APP_ID = credentials('firebase-app-id')
            }
            steps {
                sh 'npm run build'
            }
        }

        stage('Deploy Production') {
            when {
                allOf {
                    branch 'main'
                    not { changeRequest() }
                }
            }
            environment {
                CLOUDFLARE_API_TOKEN = credentials('cloudflare-api-token')
                CLOUDFLARE_ACCOUNT_ID = credentials('cloudflare-account-id')
            }
            steps {
                sh 'npx wrangler deploy'
            }
        }

        stage('Production Smoke Test') {
            when {
                allOf {
                    branch 'main'
                    not { changeRequest() }
                }
            }
            steps {
                retry(3) {
                    sh '''
                        curl --fail --silent --show-error \
                          --retry 3 --retry-delay 5 --retry-all-errors \
                          https://hangry-and-idk.site/ \
                          --output /dev/null

                        curl --fail --silent --show-error \
                          --retry 3 --retry-delay 5 --retry-all-errors \
                          https://hangry-and-idk.site/api/auth/session \
                          --output /dev/null
                    '''
                }
            }
        }
    }

    post {
        success {
            echo 'Pipeline succeeded.'
        }
        failure {
            echo 'Pipeline failed. Check the first failed stage.'
        }
        always {
            deleteDir()
        }
    }
}
