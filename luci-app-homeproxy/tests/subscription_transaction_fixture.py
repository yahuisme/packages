"""Install the production file transaction into existing isolated main fixtures.

Only literal paths are redirected. Non-filesystem reconciliation fixtures keep
an explicit commit/reload boundary stub; native fixtures execute the real code.
"""
import json
from pathlib import Path


def transaction_source(updater, config=None):
    state = updater[updater.index('const subscription_transaction ='):updater.index('function reload_service')]
    state = state.replace('subscription_before', "subscription_fs.readfile('/etc/config/homeproxy')")
    start = updater.index('function commit_subscription_changes')
    end = updater.index('function has_value')
    if config is None:
        return ('const subscription_transaction={applying:false};\n'
                'function commit_subscription_changes(){'
                'if(uci.commit(uciconfig)!==true)die("failed to commit subscription changes");'
                'return reload_service();}\n')
    return ("import * as subscription_fs from 'fs';\n" +
            (state + updater[start:end]).replace('/etc/config/homeproxy', str(config)))
