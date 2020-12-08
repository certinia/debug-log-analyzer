pipeline {
    agent { label 'vscode-extension-serverless' }
    stages {
        stage('Build') {
            steps {
                sh 'sbt prod:build'
            }
        }
        stage('Publish Release') {
            when {
                tag pattern: '^([0-9]+)\\.([0-9]+)\\.([0-9]+)$', comparator: 'REGEXP'
            }
            steps {
                withCredentials([string(credentialsId: 'LANA_VSCE_PAT', variable: 'LANA_VSCE_PAT')]) {
                    sh "vsce publish -p ${LANA_VSCE_PAT} --packagePath lana-${TAG_NAME}.vsix"
                }
            }
        }
    }
    post {
        always {
            archiveArtifacts artifacts: '*.vsix', onlyIfSuccessful: true
        }
    }
}
